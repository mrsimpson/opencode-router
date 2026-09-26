import { describe, it, expect, afterAll } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// Set required env vars before config module is loaded
const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), "router-archive-unit-"))
process.env.OPENCODE_IMAGE = "test"
process.env.ROUTER_DOMAIN = "test.local"
process.env.OPENCODE_ROUTER_EXTERNAL_DOMAIN = "test.local"
process.env.ARCHIVE_DIR = archiveDir

const { archiveSession, _setExecImpl } = await import("./archive.js")

afterAll(() => {
  fs.rmSync(archiveDir, { recursive: true, force: true })
})

describe("archiveSession", () => {
  it("resolves only after the exported JSON has been flushed to disk", async () => {
    const payload = JSON.stringify({ messages: "x".repeat(1024 * 1024) })

    // Mirrors @kubernetes/client-node: on the status frame, the WebSocket handler
    // ends stdout and then invokes the status callback synchronously.
    _setExecImpl(async (_ns, _pod, _container, _cmd, stdout, _stderr, _stdin, _tty, statusCallback) => {
      stdout.write(payload)
      stdout.end()
      statusCallback({ status: "Success" })
      return undefined
    })

    await archiveSession("flushhash", "ses_1", "pod-1", "user@example.com")

    const written = fs.readFileSync(path.join(archiveDir, "user@example.com", "flushhash.json"), "utf-8")
    expect(written).toBe(payload)
  })

  it("rejects with stderr output when the export command fails", async () => {
    _setExecImpl(async (_ns, _pod, _container, _cmd, stdout, stderr, _stdin, _tty, statusCallback) => {
      stderr.write("session not found")
      stdout.end()
      stderr.end()
      statusCallback({ status: "Failure", reason: "NonZeroExitCode" })
      return undefined
    })

    await expect(archiveSession("failhash", "ses_2", "pod-2", "user@example.com")).rejects.toThrow(
      "Export command failed (NonZeroExitCode): session not found",
    )
  })
})
