import { postJson, type OpencodeAdapter } from "./adapter.js"

// The 1.x web UI addresses a project by its base64-encoded directory (unpadded).
const WORKSPACE_BASE64 = Buffer.from("/home/opencode/repo").toString("base64").replace(/=+$/, "")

/** opencode 1.x: legacy instance routes (`/session`, `prompt_async`) and `opencode export`. */
export const v1Adapter: OpencodeAdapter = {
  generation: "v1",

  async latestRootSession(base, fetch) {
    const res = await fetch(`${base}/session?limit=1&roots=true`)
    if (!res.ok) return null
    const data = (await res.json()) as { id: string; time?: { updated?: number } }[]
    if (!data[0]) return { updatedMs: Date.now() }
    return { id: data[0].id, updatedMs: data[0].time?.updated ?? Date.now() }
  },

  async createSession(base, fetch) {
    const res = await postJson(fetch, `${base}/session`, {})
    if (!res.ok) return null
    const session = (await res.json()) as { id?: string }
    return session.id ?? null
  },

  async sendPrompt(base, sessionId, text, fetch) {
    const res = await postJson(fetch, `${base}/session/${sessionId}/prompt_async`, {
      parts: [{ type: "text", text }],
    })
    return res.ok
  },

  deepLink(podUrl, sessionId) {
    return `${podUrl}/${WORKSPACE_BASE64}/session/${sessionId}`
  },

  exportCommand(sessionId) {
    // Reads local storage directly, so it works with or without a running server.
    return ["opencode", "export", sessionId]
  },
}
