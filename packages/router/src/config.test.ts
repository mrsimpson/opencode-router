import { describe, it, expect } from "vitest"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

describe("config defaults", () => {
  it("idleTimeoutMinutes defaults to 15", () => {
    const { IDLE_TIMEOUT_MINUTES: _, ...rest } = process.env
    const env = { ...rest, OPENCODE_IMAGE: "test", ROUTER_DOMAIN: "test.local" }
    const result = spawnSync(
      process.execPath,
      ["--eval", "import('./src/config.ts').then(m => process.stdout.write(String(m.config.idleTimeoutMinutes)))"],
      { env, encoding: "utf-8", cwd: resolve(import.meta.dirname, "..") },
    )
    expect(result.stdout.trim()).toBe("15")
  })

  it("attachPort defaults to 4096", () => {
    const env = { OPENCODE_IMAGE: "test", ROUTER_DOMAIN: "test.local" }
    const result = spawnSync(
      process.execPath,
      ["--eval", "import('./src/config.ts').then(m => process.stdout.write(String(m.config.attachPort)))"],
      { env, encoding: "utf-8", cwd: resolve(import.meta.dirname, "..") },
    )
    expect(result.stdout.trim()).toBe("4096")
  })

  it("attachRoutePrefix defaults to 'attach-'", () => {
    const env = { OPENCODE_IMAGE: "test", ROUTER_DOMAIN: "test.local" }
    const result = spawnSync(
      process.execPath,
      ["--eval", "import('./src/config.ts').then(m => process.stdout.write(m.config.attachRoutePrefix))"],
      { env, encoding: "utf-8", cwd: resolve(import.meta.dirname, "..") },
    )
    expect(result.stdout.trim()).toBe("attach-")
  })

  it("opencodeRouterExternalDomain defaults to undefined", () => {
    const env = { OPENCODE_IMAGE: "test", ROUTER_DOMAIN: "test.local" }
    const result = spawnSync(
      process.execPath,
      [
        "--eval",
        "import('./src/config.ts').then(m => process.stdout.write(String(m.config.opencodeRouterExternalDomain)))",
      ],
      { env, encoding: "utf-8", cwd: resolve(import.meta.dirname, "..") },
    )
    expect(result.stdout.trim()).toBe("undefined")
  })

  it("editorPort defaults to 7681", () => {
    const env = { OPENCODE_IMAGE: "test", ROUTER_DOMAIN: "test.local" }
    const result = spawnSync(
      process.execPath,
      ["--eval", "import('./src/config.ts').then(m => process.stdout.write(String(m.config.editorPort)))"],
      { env, encoding: "utf-8", cwd: resolve(import.meta.dirname, "..") },
    )
    expect(result.stdout.trim()).toBe("7681")
  })

  it("editorRoutePrefix defaults to 'editor-'", () => {
    const env = { OPENCODE_IMAGE: "test", ROUTER_DOMAIN: "test.local" }
    const result = spawnSync(
      process.execPath,
      ["--eval", "import('./src/config.ts').then(m => process.stdout.write(m.config.editorRoutePrefix))"],
      { env, encoding: "utf-8", cwd: resolve(import.meta.dirname, "..") },
    )
    expect(result.stdout.trim()).toBe("editor-")
  })

  it("editorImage defaults to ghcr.io/mrsimpson/opencode-editor:latest", () => {
    const env = { OPENCODE_IMAGE: "test", ROUTER_DOMAIN: "test.local" }
    const result = spawnSync(
      process.execPath,
      ["--eval", "import('./src/config.ts').then(m => process.stdout.write(m.config.editorImage))"],
      { env, encoding: "utf-8", cwd: resolve(import.meta.dirname, "..") },
    )
    expect(result.stdout.trim()).toBe("ghcr.io/mrsimpson/opencode-editor:latest")
  })
})
