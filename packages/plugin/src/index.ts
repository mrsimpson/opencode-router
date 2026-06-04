import type { Plugin } from "@opencode-ai/plugin"
import { pushEvent } from "./plugin.js"
import { startPortWatcher } from "./port-watcher.js"

// Map messageID → role for text part attribution
const messageRoles = new Map<string, "user" | "assistant">()

/**
 * Set of opencode session IDs this plugin is allowed to push events for.
 *
 * - null  = replay not yet complete (or fresh pod with no sessions) → accept all
 * - Set   = replay completed AND found ≥1 session → only those IDs are accepted
 *
 * On a fresh pod the replay finds zero sessions and leaves this null so the
 * first session.created event (the router-bootstrapped session) is not dropped.
 * Once that event fires we lock down to just that session ID.
 *
 * On a resumed pod the replay finds the existing sessions and populates the set
 * before any new events arrive — correct by construction.
 */
let allowedSessionIds: Set<string> | null = null

function isAllowed(sessionID: string): boolean {
  return allowedSessionIds === null || allowedSessionIds.has(sessionID)
}

function lockToSession(sessionID: string): void {
  if (allowedSessionIds === null) {
    allowedSessionIds = new Set([sessionID])
  } else {
    allowedSessionIds.add(sessionID)
  }
}

// Replay state from the running opencode server, populating allowedSessionIds
// and re-pushing every existing message so the router recovers state after a
// pod resume. The router deduplicates by partID, so replay is always safe.
//
// Exported (under __test) so tests can drive it synchronously without waiting
// for the 5 s startup timeout.
async function runStartupReplay(input: Parameters<Plugin>[0]): Promise<void> {
  try {
    const listResult = await input.client.session.list()
    const sessions = listResult.data ?? []

    // Lock down to sessions that exist at startup — only when sessions are found.
    // Fresh pods have zero sessions; leaving allowedSessionIds = null lets the
    // first session.created event (the router-bootstrapped session) be captured.
    if (sessions.length > 0) {
      allowedSessionIds = new Set(sessions.map((s) => s.id))
    }

    for (const session of sessions) {
      if (session.title) {
        await pushEvent({ type: "session.title", sessionID: session.id, title: session.title })
      }
      const msgResult = await input.client.session.messages({ path: { id: session.id } })
      const messages = msgResult.data ?? []
      for (const entry of messages) {
        const msg = entry.info
        for (const part of (entry as any).parts ?? []) {
          if (part.type === "text" && (msg.role === "user" || msg.role === "assistant")) {
            await pushEvent({
              type: msg.role === "user" ? "message.user" : "message.assistant",
              partID: part.id,
              messageID: msg.id,
              sessionID: session.id,
              text: part.text ?? "",
              time: msg.time?.created ?? Date.now(),
            })
          }
        }
      }
    }
  } catch (err) {
    // Replay failure is non-fatal — allowedSessionIds stays null (accept-all),
    // but surface it so a chronically broken replay is diagnosable instead of silent.
    console.warn("opencode-router-plugin: startup replay failed:", err)
  }
}

// ---------------------------------------------------------------------------
// Token-metrics — push per-step token usage to VictoriaMetrics
// ---------------------------------------------------------------------------

const VM_URL = process.env.VICTORIA_METRICS_URL
const USER_EMAIL = process.env.OPENCODE_USER_EMAIL ?? "unknown"

function pushMetricsToVM(part: Record<string, any>): void {
  if (!VM_URL) return

  if (part.type !== "step-finish") return

  const tokens = part.tokens ?? {}
  const cost = part.cost ?? 0
  const modelRaw: string = part.modelID ?? part.model ?? "unknown"
  const slashIdx = modelRaw.indexOf("/")
  const provider = slashIdx !== -1 ? modelRaw.slice(0, slashIdx) : "unknown"
  const model = slashIdx !== -1 ? modelRaw.slice(slashIdx + 1) : modelRaw
  const session: string = part.sessionID ?? "unknown"

  const labels = `user="${USER_EMAIL}",model="${model}",provider="${provider}",session="${session}"`
  const lines = [
    `opencode_tokens_input_total{${labels}} ${tokens.input ?? 0}`,
    `opencode_tokens_output_total{${labels}} ${tokens.output ?? 0}`,
    `opencode_tokens_cache_read_total{${labels}} ${tokens.cache?.read ?? 0}`,
    `opencode_tokens_cache_write_total{${labels}} ${tokens.cache?.write ?? 0}`,
    `opencode_cost_usd_total{${labels}} ${cost}`,
  ].join("\n")

  fetch(`${VM_URL}/api/v1/import/prometheus`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: lines,
  }).catch((err) => {
    console.warn("opencode-router-plugin: failed to push token metrics:", err)
  })
}

const RouterPlugin: Plugin = async (input) => {
  // Run startup replay *after* returning hooks (via setTimeout) so the opencode
  // server finishes initialising and starts serving HTTP first — without this
  // delay, session.list() calls the server before it's ready, deadlocking the
  // readiness probe.
  setTimeout(() => runStartupReplay(input), 5_000)

  // Start background port watcher (no-op on non-Linux or missing env vars)
  startPortWatcher()

  return {
    event: async ({ event }) => {
      const e = event as any
      if (e.type === "session.created" || e.type === "session.updated") {
        const title = e.properties?.info?.title
        const sessionID = e.properties?.sessionID ?? e.properties?.info?.id
        if (!sessionID) return
        // On a fresh pod allowedSessionIds is null — the first session.created
        // is the router-bootstrapped session; lock down to it immediately.
        if (e.type === "session.created") lockToSession(sessionID)
        if (title && isAllowed(sessionID)) {
          await pushEvent({ type: "session.title", sessionID, title })
        }
      }
      if (e.type === "message.updated") {
        const info = e.properties?.info
        if (info?.id && info?.role) messageRoles.set(info.id, info.role)
      }
      if (e.type === "message.part.updated") {
        const part = e.properties?.part
        if (part?.type === "text") {
          const sessionID = part.sessionID ?? e.properties?.sessionID
          const role = messageRoles.get(part.messageID)
          if (role === "user" && isAllowed(sessionID)) {
            await pushEvent({
              type: "message.user",
              partID: part.id,
              messageID: part.messageID,
              sessionID,
              text: part.text ?? "",
              time: e.properties?.time ?? Date.now(),
            })
          }
        }
        // Token-metrics: push per-step token usage to VictoriaMetrics
        pushMetricsToVM(part)
      }
    },
    "experimental.text.complete": async (inp, output) => {
      if (!isAllowed(inp.sessionID)) return
      await pushEvent({
        type: "message.assistant",
        partID: inp.partID,
        messageID: inp.messageID,
        sessionID: inp.sessionID,
        text: output.text,
        time: Date.now(),
      })
    },
  }
}

export default { id: "opencode-router", server: RouterPlugin }

/**
 * Test-only handles into the plugin's module-level state. NOT a public API.
 * Tests use these to reset state between cases and to drive the replay
 * synchronously without waiting for the 5 s startup timeout.
 */
export const __test = {
  reset(): void {
    allowedSessionIds = null
    messageRoles.clear()
  },
  getAllowedSessionIds(): Set<string> | null {
    return allowedSessionIds
  },
  isAllowed,
  lockToSession,
  runStartupReplay,
}
