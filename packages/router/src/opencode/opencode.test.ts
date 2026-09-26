import { describe, it, expect, beforeEach, afterEach } from "vitest"

process.env.OPENCODE_IMAGE = "test"
process.env.ROUTER_DOMAIN = "test.local"
process.env.OPENCODE_ROUTER_EXTERNAL_DOMAIN = "test.local"

const { config } = await import("../config.js")
const { v1Adapter } = await import("./v1.js")
const { v2Adapter } = await import("./v2.js")
const { detectGeneration, resolveAdapter, knownGeneration, _clearAdapterCache } = await import("./index.js")

type Call = { url: string; method: string; body?: unknown }

/** Fake fetch answering by "METHOD path" (query included); records every call. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: Call[] = []
  const fetch = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const route = routes[`${method} ${url.replace(BASE, "")}`]
    return route ? route() : new Response("not found", { status: 404 })
  }
  return { fetch, calls }
}

const BASE = "http://10.0.0.5:4096"
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
const html = () => new Response("<!doctype html><title>OpenCode</title>", { headers: { "content-type": "text/html" } })

describe("v1 adapter (opencode 1.x)", () => {
  it("reads the newest root session from the legacy list", async () => {
    const { fetch, calls } = fakeFetch({
      "GET /session?limit=1&roots=true": () => json([{ id: "ses_a", time: { updated: 1700 } }]),
    })
    expect(await v1Adapter.latestRootSession(BASE, fetch)).toEqual({ id: "ses_a", updatedMs: 1700 })
    expect(calls).toHaveLength(1)
  })

  it("reports a reachable pod without sessions", async () => {
    const { fetch } = fakeFetch({ "GET /session?limit=1&roots=true": () => json([]) })
    const latest = await v1Adapter.latestRootSession(BASE, fetch)
    expect(latest?.id).toBeUndefined()
    expect(latest?.updatedMs).toBeGreaterThan(0)
  })

  it("creates a session and sends the prompt via prompt_async", async () => {
    const { fetch, calls } = fakeFetch({
      "POST /session": () => json({ id: "ses_new" }),
      "POST /session/ses_new/prompt_async": () => new Response(null, { status: 204 }),
    })
    expect(await v1Adapter.createSession(BASE, fetch)).toBe("ses_new")
    expect(await v1Adapter.sendPrompt(BASE, "ses_new", "fix the bug", fetch)).toBe(true)
    expect(calls[1].body).toEqual({ parts: [{ type: "text", text: "fix the bug" }] })
  })

  it("builds the workspace deep link and export command", () => {
    expect(v1Adapter.deepLink("https://abc-oc.example.com", "ses_1")).toBe(
      "https://abc-oc.example.com/L2hvbWUvb3BlbmNvZGUvcmVwbw/session/ses_1",
    )
    expect(v1Adapter.exportCommand("ses_1", "running")).toEqual(["opencode", "export", "ses_1"])
    expect(v1Adapter.exportCommand("ses_1", "stopped")).toEqual(["opencode", "export", "ses_1"])
  })
})

describe("v2 adapter (opencode 2.x)", () => {
  it("reads the newest root session from the paginated /api list", async () => {
    const { fetch, calls } = fakeFetch({
      "GET /api/session?limit=1&order=desc&parentID=null": () =>
        json({ data: [{ id: "ses_b", time: { created: 1, updated: 2500 } }], cursor: {} }),
    })
    expect(await v2Adapter.latestRootSession(BASE, fetch)).toEqual({ id: "ses_b", updatedMs: 2500 })
    expect(calls[0].url).toBe(`${BASE}/api/session?limit=1&order=desc&parentID=null`)
  })

  it("rejects a list response without data", async () => {
    const { fetch } = fakeFetch({ "GET /api/session?limit=1&order=desc&parentID=null": () => json([]) })
    expect(await v2Adapter.latestRootSession(BASE, fetch)).toBeNull()
  })

  it("creates a session and admits the prompt via /api", async () => {
    const { fetch, calls } = fakeFetch({
      "POST /api/session": () => json({ data: { id: "ses_v2" } }),
      "POST /api/session/ses_v2/prompt": () => json({ data: { admittedSeq: 1 } }),
    })
    expect(await v2Adapter.createSession(BASE, fetch)).toBe("ses_v2")
    expect(await v2Adapter.sendPrompt(BASE, "ses_v2", "fix the bug", fetch)).toBe(true)
    expect(calls[1].body).toEqual({ prompt: { text: "fix the bug" } })
  })

  it("fails bootstrap steps on error responses", async () => {
    const { fetch } = fakeFetch({})
    expect(await v2Adapter.createSession(BASE, fetch)).toBeNull()
    expect(await v2Adapter.sendPrompt(BASE, "ses_x", "hi", fetch)).toBe(false)
  })

  it("builds the server-keyed deep link", () => {
    const podUrl = "https://abc-oc.example.com"
    const link = v2Adapter.deepLink(podUrl, "ses_1")
    expect(link).toBe("https://abc-oc.example.com/server/aHR0cHM6Ly9hYmMtb2MuZXhhbXBsZS5jb20/session/ses_1")
    // opencode's base64Encode: unpadded, URL-safe
    const key = link.split("/server/")[1].split("/")[0]
    expect(key).not.toMatch(/[=+/]/)
    expect(Buffer.from(key, "base64url").toString()).toBe(podUrl)
  })

  it("targets the pod's server when running and a private server when stopped", () => {
    expect(v2Adapter.exportCommand("ses_1", "running")).toEqual([
      "opencode",
      "session",
      "export",
      "ses_1",
      "--server",
      `http://localhost:${config.opencodePort}`,
    ])
    expect(v2Adapter.exportCommand("ses_1", "stopped")).toEqual(["opencode", "session", "export", "ses_1", "--standalone"])
  })
})

describe("detectGeneration", () => {
  it("detects 2.x from the JSON /api/info endpoint, even for dev snapshot versions", async () => {
    const { fetch } = fakeFetch({ "GET /api/info": () => json({ version: "0.0.0-dev-202609252333", pid: 1 }) })
    expect(await detectGeneration(BASE, fetch)).toBe("v2")
  })

  it("treats 1.x's HTML catch-all for /api/info as v1", async () => {
    const { fetch } = fakeFetch({ "GET /api/info": html })
    expect(await detectGeneration(BASE, fetch)).toBe("v1")
  })

  it("treats a 404 as v1", async () => {
    const { fetch } = fakeFetch({})
    expect(await detectGeneration(BASE, fetch)).toBe("v1")
  })

  it("returns null while the server is unreachable or failing", async () => {
    expect(await detectGeneration(BASE, async () => Promise.reject(new Error("ECONNREFUSED")))).toBeNull()
    expect(await detectGeneration(BASE, async () => new Response("", { status: 503 }))).toBeNull()
  })
})

describe("resolveAdapter", () => {
  const originalApi = config.opencodeApi
  beforeEach(() => _clearAdapterCache())
  afterEach(() => {
    config.opencodeApi = originalApi
    _clearAdapterCache()
  })

  it("probes once per pod and shares the probe between concurrent callers", async () => {
    const { fetch, calls } = fakeFetch({ "GET /api/info": () => json({ version: "2.0.18" }) })
    const [a, b] = await Promise.all([resolveAdapter("h1", BASE, fetch), resolveAdapter("h1", BASE, fetch)])
    expect(a?.generation).toBe("v2")
    expect(b).toBe(a)
    expect((await resolveAdapter("h1", BASE, fetch))?.generation).toBe("v2")
    expect(calls).toHaveLength(1)
    expect(knownGeneration("h1")).toBe("v2")
  })

  it("probes again when the pod's base URL changes", async () => {
    const { fetch, calls } = fakeFetch({ "GET /api/info": html })
    await resolveAdapter("h1", BASE, fetch)
    await resolveAdapter("h1", "http://10.0.0.6:4096", fetch)
    expect(calls).toHaveLength(2)
  })

  it("does not cache an unreachable pod", async () => {
    let up = false
    const fetch = async () => {
      if (!up) throw new Error("ECONNREFUSED")
      return json({ version: "2.0.18" })
    }
    expect(await resolveAdapter("h1", BASE, fetch)).toBeNull()
    expect(knownGeneration("h1")).toBeUndefined()
    up = true
    expect((await resolveAdapter("h1", BASE, fetch))?.generation).toBe("v2")
  })

  it("skips detection when OPENCODE_API pins a generation", async () => {
    config.opencodeApi = "v2"
    const { fetch, calls } = fakeFetch({})
    expect((await resolveAdapter("h1", BASE, fetch))?.generation).toBe("v2")
    expect(knownGeneration("h9")).toBe("v2")
    expect(calls).toHaveLength(0)
  })
})
