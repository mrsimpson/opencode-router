import { config } from "../config.js"
import type { FetchFn, OpencodeAdapter, OpencodeGeneration } from "./adapter.js"
import { v1Adapter } from "./v1.js"
import { v2Adapter } from "./v2.js"

export type { ExportMode, FetchFn, LatestSession, OpencodeAdapter, OpencodeGeneration } from "./adapter.js"

const adapters: Record<OpencodeGeneration, OpencodeAdapter> = { v1: v1Adapter, v2: v2Adapter }

export function isGeneration(value: unknown): value is OpencodeGeneration {
  return value === "v1" || value === "v2"
}

export function adapterFor(generation: OpencodeGeneration): OpencodeAdapter {
  return adapters[generation]
}

/** Generation pinned via OPENCODE_API, or undefined when auto-detecting. */
export function pinnedGeneration(): OpencodeGeneration | undefined {
  return isGeneration(config.opencodeApi) ? config.opencodeApi : undefined
}

/**
 * Probe a pod's opencode server. Only 2.x serves `GET /api/info` as JSON with a `version`;
 * 1.x answers that path with its web UI (HTML) or 404. Version numbers are not compared
 * because dev snapshots report `0.0.0-dev-…`.
 * Returns null when the server can't be reached or errors, so the caller retries later.
 */
export async function detectGeneration(base: string, fetch: FetchFn): Promise<OpencodeGeneration | null> {
  let res: Response
  try {
    res = await fetch(`${base}/api/info`)
  } catch {
    return null
  }
  if (res.status >= 500) return null
  if (res.ok && res.headers.get("content-type")?.includes("json")) {
    try {
      const body = (await res.json()) as { version?: unknown }
      if (typeof body?.version === "string") return "v2"
    } catch {
      // not JSON after all — fall through to v1
    }
  }
  return "v1"
}

type CacheEntry = { base: string; adapter: Promise<OpencodeAdapter | null> }
const cache = new Map<string, CacheEntry>()
const resolved = new Map<string, OpencodeGeneration>()

/**
 * Adapter for the opencode server of session `hash` at `base`. Detection runs once per pod:
 * the result is cached until the pod's base URL changes (a new pod). Concurrent callers share
 * one probe. Returns null while the pod is unreachable.
 */
export function resolveAdapter(hash: string, base: string, fetch: FetchFn): Promise<OpencodeAdapter | null> {
  const pinned = pinnedGeneration()
  if (pinned) return Promise.resolve(adapters[pinned])

  const entry = cache.get(hash)
  if (entry && entry.base === base) return entry.adapter

  const adapter = detectGeneration(base, fetch).then((generation) => {
    if (!generation) {
      if (cache.get(hash)?.adapter === adapter) cache.delete(hash)
      return null
    }
    resolved.set(hash, generation)
    return adapters[generation]
  })
  cache.set(hash, { base, adapter })
  return adapter
}

/** Generation last detected (or pinned) for session `hash`, if known. */
export function knownGeneration(hash: string): OpencodeGeneration | undefined {
  return pinnedGeneration() ?? resolved.get(hash)
}

/** For testing only: forget detected generations. */
export function _clearAdapterCache() {
  cache.clear()
  resolved.clear()
}
