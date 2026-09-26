import { config } from "../config.js"
import { postJson, type OpencodeAdapter } from "./adapter.js"

type SessionV2 = { id: string; time?: { updated?: number } }

/**
 * opencode 2.x: the `/api/*` HTTP API (the legacy instance routes were removed) and
 * `opencode session export`. Contract per packages/protocol/openapi.json at v2.0.18.
 */
export const v2Adapter: OpencodeAdapter = {
  generation: "v2",

  async latestRootSession(base, fetch) {
    // parentID=null restricts the list to root sessions (the 1.x `roots=true`).
    const res = await fetch(`${base}/api/session?limit=1&order=desc&parentID=null`)
    if (!res.ok) return null
    const body = (await res.json()) as { data?: SessionV2[] }
    if (!Array.isArray(body.data)) return null
    const session = body.data[0]
    if (!session) return { updatedMs: Date.now() }
    return { id: session.id, updatedMs: session.time?.updated ?? Date.now() }
  },

  async createSession(base, fetch) {
    const res = await postJson(fetch, `${base}/api/session`, {})
    if (!res.ok) return null
    const body = (await res.json()) as { data?: { id?: string } }
    return body.data?.id ?? null
  },

  async sendPrompt(base, sessionId, text, fetch) {
    // Admission is durable and returns before the model runs (replaces prompt_async).
    const res = await postJson(fetch, `${base}/api/session/${sessionId}/prompt`, { prompt: { text } })
    return res.ok
  },

  deepLink(podUrl, sessionId) {
    // The 2.x web UI keys sessions by server: /server/<unpadded URL-safe base64 of the server URL>/session/<id>.
    // When served by `opencode serve`, the server URL is the page origin.
    return `${podUrl}/server/${Buffer.from(podUrl).toString("base64url")}/session/${sessionId}`
  },

  exportCommand(sessionId, mode) {
    // Without --server/--standalone the 2.x CLI looks for a background service, which pods don't run.
    const target = mode === "running" ? ["--server", `http://localhost:${config.opencodePort}`] : ["--standalone"]
    return ["opencode", "session", "export", sessionId, ...target]
  },
}
