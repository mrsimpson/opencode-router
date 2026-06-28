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

  it("modelThinking defaults to undefined when OPENCODE_MODEL_THINKING is unset", () => {
    const env = { OPENCODE_IMAGE: "test", ROUTER_DOMAIN: "test.local" }
    const result = spawnSync(
      process.execPath,
      ["--eval", "import('./src/config.ts').then(m => process.stdout.write(String(m.config.modelThinking)))"],
      { env, encoding: "utf-8", cwd: resolve(import.meta.dirname, "..") },
    )
    expect(result.stdout.trim()).toBe("undefined")
  })

  it("modelCoding defaults to undefined when OPENCODE_MODEL_CODING is unset", () => {
    const env = { OPENCODE_IMAGE: "test", ROUTER_DOMAIN: "test.local" }
    const result = spawnSync(
      process.execPath,
      ["--eval", "import('./src/config.ts').then(m => process.stdout.write(String(m.config.modelCoding)))"],
      { env, encoding: "utf-8", cwd: resolve(import.meta.dirname, "..") },
    )
    expect(result.stdout.trim()).toBe("undefined")
  })

  it("modelResearch defaults to undefined when OPENCODE_MODEL_RESEARCH is unset", () => {
    const env = { OPENCODE_IMAGE: "test", ROUTER_DOMAIN: "test.local" }
    const result = spawnSync(
      process.execPath,
      ["--eval", "import('./src/config.ts').then(m => process.stdout.write(String(m.config.modelResearch)))"],
      { env, encoding: "utf-8", cwd: resolve(import.meta.dirname, "..") },
    )
    expect(result.stdout.trim()).toBe("undefined")
  })

  it("modelThinking is read from OPENCODE_MODEL_THINKING env var", () => {
    const env = {
      OPENCODE_IMAGE: "test",
      ROUTER_DOMAIN: "test.local",
      OPENCODE_MODEL_THINKING: "claude-opus-4-1",
    }
    const result = spawnSync(
      process.execPath,
      ["--eval", "import('./src/config.ts').then(m => process.stdout.write(m.config.modelThinking))"],
      { env, encoding: "utf-8", cwd: resolve(import.meta.dirname, "..") },
    )
    expect(result.stdout.trim()).toBe("claude-opus-4-1")
  })

  it("modelCoding is read from OPENCODE_MODEL_CODING env var", () => {
    const env = {
      OPENCODE_IMAGE: "test",
      ROUTER_DOMAIN: "test.local",
      OPENCODE_MODEL_CODING: "claude-sonnet-4-5",
    }
    const result = spawnSync(
      process.execPath,
      ["--eval", "import('./src/config.ts').then(m => process.stdout.write(m.config.modelCoding))"],
      { env, encoding: "utf-8", cwd: resolve(import.meta.dirname, "..") },
    )
    expect(result.stdout.trim()).toBe("claude-sonnet-4-5")
  })

  it("modelResearch is read from OPENCODE_MODEL_RESEARCH env var", () => {
    const env = {
      OPENCODE_IMAGE: "test",
      ROUTER_DOMAIN: "test.local",
      OPENCODE_MODEL_RESEARCH: "claude-haiku-4-5",
    }
    const result = spawnSync(
      process.execPath,
      ["--eval", "import('./src/config.ts').then(m => process.stdout.write(m.config.modelResearch))"],
      { env, encoding: "utf-8", cwd: resolve(import.meta.dirname, "..") },
    )
    expect(result.stdout.trim()).toBe("claude-haiku-4-5")
  })

  it("all three model env vars are read independently when set together", () => {
    const env = {
      OPENCODE_IMAGE: "test",
      ROUTER_DOMAIN: "test.local",
      OPENCODE_MODEL_THINKING: "claude-opus-4-1",
      OPENCODE_MODEL_CODING: "claude-sonnet-4-5",
      OPENCODE_MODEL_RESEARCH: "claude-haiku-4-5",
    }
    const result = spawnSync(
      process.execPath,
      [
        "--eval",
        "import('./src/config.ts').then(m => process.stdout.write(JSON.stringify({t: m.config.modelThinking, c: m.config.modelCoding, r: m.config.modelResearch})))",
      ],
      { env, encoding: "utf-8", cwd: resolve(import.meta.dirname, "..") },
    )
    expect(result.stdout.trim()).toBe('{"t":"claude-opus-4-1","c":"claude-sonnet-4-5","r":"claude-haiku-4-5"}')
  })
})
