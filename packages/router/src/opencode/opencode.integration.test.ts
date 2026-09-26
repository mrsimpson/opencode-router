/**
 * Runs the adapters against a real opencode server. Opt-in:
 *   OPENCODE_BIN=/path/to/opencode pnpm --filter ./packages/router test
 * Verified with opencode 1.18.32, whose `/api` preview also serves the routes the v2 adapter uses.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { spawn, execFileSync, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

process.env.OPENCODE_IMAGE = "test"
process.env.ROUTER_DOMAIN = "test.local"
process.env.OPENCODE_ROUTER_EXTERNAL_DOMAIN = "test.local"

const { v1Adapter } = await import("./v1.js")
const { v2Adapter } = await import("./v2.js")
const { detectGeneration } = await import("./index.js")

const bin = process.env.OPENCODE_BIN
const PORT = 4197
const BASE = `http://127.0.0.1:${PORT}`
const fetch = (url: string, init?: RequestInit) => globalThis.fetch(url, init)

describe.skipIf(!bin)("adapters against a real opencode server", () => {
  let server: ChildProcess
  let workdir: string
  let env: NodeJS.ProcessEnv

  beforeAll(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-it-"))
    env = { ...process.env, HOME: path.join(workdir, "home"), XDG_DATA_HOME: path.join(workdir, "data") }
    server = spawn(bin!, ["serve", "--hostname", "127.0.0.1", "--port", String(PORT)], { cwd: workdir, env })
    let output = ""
    server.stdout?.on("data", (d) => (output += d))
    server.stderr?.on("data", (d) => (output += d))
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${BASE}/session`)).ok || (await fetch(`${BASE}/api/info`)).ok) return
      } catch {
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error(`opencode server did not start:\n${output}`)
  }, 60_000)

  afterAll(() => {
    server?.kill()
    fs.rmSync(workdir, { recursive: true, force: true })
  })

  it("detects the server generation", async () => {
    const version = execFileSync(bin!, ["--version"], { env }).toString().trim()
    expect(await detectGeneration(BASE, fetch)).toBe(version.startsWith("1.") ? "v1" : "v2")
  })

  for (const adapter of [v1Adapter, v2Adapter]) {
    it(`${adapter.generation}: bootstraps a session and finds it as the newest root session`, async () => {
      const sessionId = await adapter.createSession(BASE, fetch)
      expect(sessionId).toMatch(/^ses_/)
      expect(await adapter.sendPrompt(BASE, sessionId!, "hello from the router integration test", fetch)).toBe(true)
      const latest = await adapter.latestRootSession(BASE, fetch)
      expect(latest?.id).toBe(sessionId)
      expect(latest?.updatedMs).toBeGreaterThan(0)
    })
  }

  it("exports a session with the generation's export command", async () => {
    const version = execFileSync(bin!, ["--version"], { env }).toString().trim()
    const adapter = version.startsWith("1.") ? v1Adapter : v2Adapter
    const sessionId = await adapter.createSession(BASE, fetch)
    const [cmd, ...args] = adapter
      .exportCommand(sessionId!, "running")
      .map((a) => a.replace(/localhost:\d+/, `127.0.0.1:${PORT}`))
    const out = execFileSync(cmd === "opencode" ? bin! : cmd, args, { cwd: workdir, env }).toString()
    expect(JSON.stringify(JSON.parse(out))).toContain(sessionId!)
  }, 60_000)
})
