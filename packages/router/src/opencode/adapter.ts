/**
 * Version-specific access to the opencode server running in a session pod.
 * See docs/adr-003-opencode-version-adapters.md.
 */

// Narrow function type — `typeof fetch` differs between Bun and DOM lib.
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export type OpencodeGeneration = "v1" | "v2"

export interface LatestSession {
  /** Most recently updated root session, or undefined when the pod has no sessions yet. */
  id?: string
  /** Last activity (epoch ms) reported by opencode, or now when there are no sessions. */
  updatedMs: number
}

/** "running": the pod's opencode server is up. "stopped": temporary export pod without a server. */
export type ExportMode = "running" | "stopped"

export interface OpencodeAdapter {
  readonly generation: OpencodeGeneration
  /** Newest root session on the pod. Returns null when the pod is unreachable or answers unexpectedly. */
  latestRootSession(base: string, fetch: FetchFn): Promise<LatestSession | null>
  /** Create a session and return its ID, or null on failure. */
  createSession(base: string, fetch: FetchFn): Promise<string | null>
  /** Submit a prompt without waiting for the model to answer. */
  sendPrompt(base: string, sessionId: string, text: string, fetch: FetchFn): Promise<boolean>
  /** Web UI URL that opens the session, for the pod's public URL (no trailing slash). */
  deepLink(podUrl: string, sessionId: string): string
  /** Command exec'd in the opencode container that prints the session export JSON to stdout. */
  exportCommand(sessionId: string, mode: ExportMode): string[]
}

export async function postJson(fetch: FetchFn, url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}
