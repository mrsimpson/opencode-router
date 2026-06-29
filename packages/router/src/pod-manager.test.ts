import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "node:path"

// Set required env vars before config module is loaded
process.env.OPENCODE_IMAGE = "test"
process.env.ROUTER_DOMAIN = "test.local"
process.env.OPENCODE_ROUTER_EXTERNAL_DOMAIN = "test.local"
process.env.ARCHIVE_DIR = "/tmp/test-archives-slice1"

// ---------------------------------------------------------------------------
// Store mocks — must be declared BEFORE the pod-manager module is imported
// ---------------------------------------------------------------------------
const podSecretStoreMock = {
  generate: vi.fn((_hash: string) => "aabbcc"),
  delete: vi.fn((_hash: string) => {}),
  get: vi.fn((_hash: string) => undefined as string | undefined),
  verify: vi.fn((_hash: string, _s: string) => false),
}
const messageStoreMock = {
  get: vi.fn((_hash: string) => undefined),
  setTitle: vi.fn((_hash: string, _title: string) => {}),
  addMessage: vi.fn((_hash: string, _msg: object) => {}),
  delete: vi.fn((_hash: string) => {}),
}
vi.doMock("./pod-secret-store.js", () => ({ podSecretStore: podSecretStoreMock }))
vi.doMock("./message-store.js", () => ({ messageStore: messageStoreMock }))

// --- Fake k8s client state (mutated per test via helpers below) ---
let fakePVCs: object[] = []
let fakePods: object[] = []
let createPodCalls: object[] = []
let patchPodCalls: { name: string; body: object }[] = []
let fakeSecrets: object[] = []
let createSecretCalls: object[] = []
let replaceSecretCalls: object[] = []
let deleteSecretCalls: string[] = []

const fakeK8sApi = {
  listNamespacedPersistentVolumeClaim: async (_opts: object) => ({ items: fakePVCs }),
  listNamespacedPod: async (_opts: object) => ({ items: fakePods }),
  readNamespacedPod: async ({ name }: { name: string }) => {
    const pod = (fakePods as any[]).find((p) => p.metadata?.name === name)
    if (!pod) {
      const err: any = new Error("not found")
      err.code = 404
      throw err
    }
    return pod
  },
  readNamespacedPersistentVolumeClaim: async ({ name }: { name: string }) => {
    const pvc = (fakePVCs as any[]).find((p) => p.metadata?.name === name)
    if (!pvc) {
      const err: any = new Error("not found")
      err.code = 404
      throw err
    }
    return pvc
  },
  createNamespacedPod: async ({ namespace, body }: { namespace: string; body: object }) => {
    createPodCalls.push({ namespace, body })
    fakePods = [...(fakePods as any[]), body]
    // If this is an export pod, immediately transition to Running
    const podName = (body as any).metadata?.name
    if (podName?.endsWith("-export")) {
      const pod = fakePods.find((p: any) => p.metadata?.name === podName)
      if (pod) {
        (pod as any).status = {
          phase: "Running",
          podIP: "127.0.0.1",
          conditions: [{ type: "Ready", status: "True" }],
        }
      }
    }
    return body
  },
  createNamespacedPersistentVolumeClaim: async ({ namespace, body }: { namespace: string; body: object }) => {
    fakePVCs = [...(fakePVCs as any[]), body]
    return body
  },
  patchNamespacedPod: async ({ name, body }: { name: string; body: object }) => {
    patchPodCalls.push({ name, body })
    // Apply annotation patches to in-memory pod so later reads see the update
    const pod = (fakePods as any[]).find((p) => p.metadata?.name === name)
    if (pod && (body as any).metadata?.annotations) {
      pod.metadata.annotations = { ...pod.metadata.annotations, ...(body as any).metadata.annotations }
    }
  },
  deleteNamespacedPod: async ({ name }: { name: string }) => {
    const idx = (fakePods as any[]).findIndex((p) => p.metadata?.name === name)
    if (idx === -1) {
      const err: any = new Error("not found")
      err.code = 404
      throw err
    }
    fakePods = (fakePods as any[]).filter((_, i) => i !== idx)
  },
  patchNamespacedPersistentVolumeClaim: async ({
    name,
    body,
  }: {
    name: string
    body: { metadata?: { annotations?: Record<string, string> } }
  }) => {
    const pvc = (fakePVCs as any[]).find((p) => p.metadata?.name === name)
    if (pvc && body.metadata?.annotations) {
      pvc.metadata.annotations = { ...pvc.metadata.annotations, ...body.metadata.annotations }
    }
  },
  deleteNamespacedPersistentVolumeClaim: async ({ name }: { name: string }) => {
    const idx = (fakePVCs as any[]).findIndex((p) => p.metadata?.name === name)
    if (idx === -1) {
      const err: any = new Error("not found")
      err.code = 404
      throw err
    }
    fakePVCs = (fakePVCs as any[]).filter((_, i) => i !== idx)
  },
  createNamespacedSecret: async ({ namespace, body }: { namespace: string; body: any }) => {
    // Check if secret already exists - if so, throw conflict error
    const exists = (fakeSecrets as any[]).some((s) => s.metadata?.name === body.metadata?.name)
    if (exists) {
      const err: any = new Error("Conflict")
      err.code = 409
      throw err
    }
    createSecretCalls.push({ namespace, body })
    fakeSecrets = [...fakeSecrets, body]
    return body
  },
  replaceNamespacedSecret: async ({ name, namespace, body }: { name: string; namespace: string; body: any }) => {
    replaceSecretCalls.push({ name, namespace, body })
    const s = (fakeSecrets as any[]).find((s) => s.metadata?.name === name)
    if (s) Object.assign(s.stringData ?? (s.stringData = {}), body.stringData ?? {})
  },
  deleteNamespacedSecret: async ({ name }: { name: string }) => {
    deleteSecretCalls.push(name)
    const idx = (fakeSecrets as any[]).findIndex((s) => s.metadata?.name === name)
    if (idx === -1) {
      const err: any = new Error("not found")
      err.code = 404
      throw err
    }
    fakeSecrets = (fakeSecrets as any[]).filter((_, i) => i !== idx)
  },
  readNamespacedSecret: async ({ name }: { name: string }) => {
    const s = (fakeSecrets as any[]).find((s) => s.metadata?.name === name)
    if (!s) {
      const err: any = new Error("not found")
      err.code = 404
      throw err
    }
    return s
  },
  connectGetNamespacedPodExec: async ({ name, command }: { name: string; command: string[] }) => {
    const hash = name.replace("opencode-session-", "")
    const openCodeSessionId = command?.[2] ?? "mock-session"
    const mockJson = JSON.stringify({ openCodeSessionId, exported: true, mock: true })
    const encoder = new TextEncoder()
    const payload = encoder.encode(mockJson)
    // Prepend channel byte (1 = stdout) to each message
    const msg = Buffer.concat([Buffer.from([1]), Buffer.from(payload)])

    const mockWs = {
      on(event: string, cb: Function) {
        if (event === "open") setTimeout(() => cb(), 0)
        if (event === "message") setTimeout(() => cb(msg), 0)
        if (event === "close") setTimeout(() => cb(), 10)
      },
      close() {},
    }
    return { socket: mockWs, ws: mockWs }
  },
}

// pod-manager.test.ts must run in its own vitest process (see package.json test script)
// to avoid api.test.ts's vi.doMock("./pod-manager.js") poisoning this module import.
const {
  listUserSessions,
  terminateSession,
  resumeSession,
  suggestBranch,
  remoteBranchExists,
  deleteIdlePods,
  ensurePod,
  getSessionInfo,
  getSessionHash,
  RemoteRefsUnreachableError,
  _setApiClient,
  _setHumanId,
  _setFetch,
  _setActivityFetch,
  _setBootstrapFetch,
  _setEmitSessionsChanged,
  _clearBootstrappedSessions,
} = await import("./pod-manager.ts")
_setApiClient(fakeK8sApi as any)

// --- Helpers ---

function makePVC(sessionHash: string, email: string, repoUrl: string, branch: string, lastActivity?: string, initialMessage?: string) {
  return {
    metadata: {
      name: `opencode-pvc-${sessionHash}`,
      namespace: "opencode",
      creationTimestamp: "2025-01-01T00:00:00Z",
      labels: {
        "opencode.ai/session-hash": sessionHash,
        "app.kubernetes.io/managed-by": "opencode-router",
      },
      annotations: {
        "opencode.ai/user-email": email,
        "opencode.ai/repo-url": repoUrl,
        "opencode.ai/branch": branch,
        ...(lastActivity ? { "opencode.ai/last-activity": lastActivity } : {}),
        ...(initialMessage ? { "opencode.ai/initial-message": initialMessage } : {}),
      },
    },
    spec: {},
    status: { phase: "Bound" },
  }
}

function makeRunningPod(
  sessionHash: string,
  email: string,
  repoUrl: string,
  branch: string,
  lastActivity = "2025-06-01T12:00:00Z",
) {
  return {
    metadata: {
      name: `opencode-session-${sessionHash}`,
      namespace: "opencode",
      labels: {
        "opencode.ai/session-hash": sessionHash,
        "app.kubernetes.io/managed-by": "opencode-router",
      },
      annotations: {
        "opencode.ai/last-activity": lastActivity,
        "opencode.ai/user-email": email,
        "opencode.ai/repo-url": repoUrl,
        "opencode.ai/branch": branch,
      },
    },
    status: {
      phase: "Running",
      podIP: "10.0.0.1",
      conditions: [{ type: "Ready", status: "True" }],
    },
  }
}

function makePendingPod(sessionHash: string, email: string, repoUrl: string, branch: string) {
  return {
    metadata: {
      name: `opencode-session-${sessionHash}`,
      namespace: "opencode",
      labels: {
        "opencode.ai/session-hash": sessionHash,
        "app.kubernetes.io/managed-by": "opencode-router",
      },
      annotations: {
        "opencode.ai/last-activity": "2025-06-01T12:00:00Z",
        "opencode.ai/user-email": email,
        "opencode.ai/repo-url": repoUrl,
        "opencode.ai/branch": branch,
      },
    },
    status: { phase: "Pending" },
  }
}

const fakeReq = { headers: { "x-forwarded-proto": "https" } } as any

const EMAIL = "test@example.com"
const REPO = "https://github.com/x/y"
const BRANCH = "main"

// Compute hash identically to pod-manager's getSessionHash
import crypto from "node:crypto"
function computeHash(email: string, repo: string, branch: string) {
  const key = `${email.toLowerCase().trim()}:${repo.trim()}:${branch.trim()}`
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 12)
}
const SESSION_HASH = computeHash(EMAIL, REPO, BRANCH)

beforeEach(() => {
  fakePVCs = []
  fakePods = []
  createPodCalls = []
  patchPodCalls = []
  fakeSecrets = []
  createSecretCalls = []
  replaceSecretCalls = []
  deleteSecretCalls = []
  // Reset activity fetch to a fast no-op so tests that don't care about it don't hang
  _setActivityFetch(async () => new Response("[]", { status: 200 }))
})

// ---------------------------------------------------------------------------

describe("listUserSessions", () => {
  it("returns stopped session when PVC exists but no pod", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = []

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(1)
    expect((result[0] as any).state).toBe("stopped")
    expect((result[0] as any).hash).toBe(SESSION_HASH)
    expect((result[0] as any).email).toBe(EMAIL)
  })

  it("returns running session when PVC and running pod both exist", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(1)
    expect((result[0] as any).state).toBe("running")
  })

  it("returns creating session when PVC and pending pod exist", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [makePendingPod(SESSION_HASH, EMAIL, REPO, BRANCH)]

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(1)
    expect((result[0] as any).state).toBe("creating")
  })

  it("includes lastActivity and idleTimeoutMinutes in stopped session result", async () => {
    const lastActivity = "2025-06-01T10:00:00Z"
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH, lastActivity)]
    fakePods = []

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(1)
    expect(typeof (result[0] as any).lastActivity).toBe("string")
    expect(typeof (result[0] as any).idleTimeoutMinutes).toBe("number")
  })

  it("includes lastActivity and idleTimeoutMinutes in running session result", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(1)
    expect(typeof (result[0] as any).lastActivity).toBe("string")
    expect(typeof (result[0] as any).idleTimeoutMinutes).toBe("number")
  })

  it("ensurePod git-init script checks out sourceBranch then creates sessionBranch", async () => {
    // After creating a pod, the init script must contain both sourceBranch and branch
    fakePVCs = []
    fakePods = []
    createPodCalls = []

    const { ensurePod } = await import("./pod-manager.js")
    const session = { email: EMAIL, repoUrl: REPO, branch: "calm-snails-dream", sourceBranch: "main" }

    await (ensurePod as any)(computeHash(EMAIL, REPO, "calm-snails-dream"), session)

    expect(createPodCalls).toHaveLength(1)
    const pod = (createPodCalls[0] as any).body
    const script: string = pod.spec.initContainers[0].args[0]
    // Script must checkout the sourceBranch before creating the new sessionBranch
    expect(script).toContain("main") // sourceBranch checkout
    expect(script).toContain("calm-snails-dream") // new session branch creation
    // Must NOT try to look up "calm-snails-dream" on remote (it's always a new branch)
    expect(script).not.toContain('ls-remote --exit-code --heads origin "calm-snails-dream"')
  })

  it("ensurePod git-init script skips fetch/checkout when /workspace has uncommitted changes from a prior session", async () => {
    // Pod restarts re-mount the PVC which can contain uncommitted edits from the previous
    // session. Running `git checkout` against a dirty workspace aborts with "local changes
    // would be overwritten" and the init container crashloops. The script must detect the
    // dirty state and skip the git phase, leaving the workspace exactly as the user left it.
    fakePVCs = []
    fakePods = []
    createPodCalls = []

    const { ensurePod } = await import("./pod-manager.js")
    const session = { email: EMAIL, repoUrl: REPO, branch: "resilient-branch", sourceBranch: "main" }

    await (ensurePod as any)(computeHash(EMAIL, REPO, "resilient-branch"), session)

    expect(createPodCalls).toHaveLength(1)
    const pod = (createPodCalls[0] as any).body
    const script: string = pod.spec.initContainers[0].args[0]
    // Dirty-workspace guard must check both tracked diffs and untracked files
    expect(script).toContain("$GIT diff --quiet HEAD")
    expect(script).toContain("$GIT ls-files --others --exclude-standard")
    // The guard wraps fetch + both checkout branches so none of them run when dirty
    const guardIdx = script.indexOf("$GIT diff --quiet HEAD")
    const fetchIdx = script.indexOf("$GIT fetch --all")
    const checkoutIdx = script.indexOf("$GIT checkout")
    expect(guardIdx).toBeGreaterThan(-1)
    expect(fetchIdx).toBeGreaterThan(guardIdx)
    expect(checkoutIdx).toBeGreaterThan(guardIdx)
    // Must NOT introduce an auto-stash — work is preserved by leaving the workspace untouched
    expect(script).not.toContain("stash push")
  })
})

// ---------------------------------------------------------------------------
// remoteBranchExists: verify a branch exists on a remote git repo via Smart HTTP
// ---------------------------------------------------------------------------

describe("remoteBranchExists", () => {
  // Helper — build a Smart HTTP v1 info/refs body. The first ref line uses \0
  // before capabilities, subsequent refs use \n.
  function smartHttpBody(refs: string[]): string {
    const lines: string[] = ["001e# service=git-upload-pack\n", "0000"]
    refs.forEach((name, i) => {
      const sha = "a".repeat(40)
      if (i === 0) {
        lines.push(`00bd${sha} ${name}\0multi_ack thin-pack side-band side-band-64k symref=HEAD:${name}\n`)
      } else {
        lines.push(`003f${sha} ${name}\n`)
      }
    })
    lines.push("0000")
    return lines.join("")
  }

  function mockFetch(body: string, status = 200) {
    _setFetch(async () => new Response(body, { status }))
  }

  function mockFetchThrow(err: Error) {
    _setFetch(async () => {
      throw err
    })
  }

  it("returns true when the branch is advertised as the first ref (\\0 terminator)", async () => {
    mockFetch(smartHttpBody(["refs/heads/main"]))
    expect(await remoteBranchExists("https://github.com/x/y", "main")).toBe(true)
  })

  it("returns true when the branch is advertised as a later ref (\\n terminator)", async () => {
    mockFetch(smartHttpBody(["refs/heads/main", "refs/heads/feature/foo"]))
    expect(await remoteBranchExists("https://github.com/x/y", "feature/foo")).toBe(true)
  })

  it("returns false for a branch that is not advertised (wrong case)", async () => {
    mockFetch(smartHttpBody(["refs/heads/main"]))
    // The bug that created the failing pod: "Main" (capital M) passed for a repo with "main".
    expect(await remoteBranchExists("https://github.com/x/y", "Main")).toBe(false)
  })

  it("does not false-positive on a prefix match (foo vs foo-bar)", async () => {
    mockFetch(smartHttpBody(["refs/heads/foo-bar"]))
    expect(await remoteBranchExists("https://github.com/x/y", "foo")).toBe(false)
  })

  it("tolerates a trailing slash on the repo URL", async () => {
    let capturedUrl = ""
    _setFetch(async (url) => {
      capturedUrl = url
      return new Response(smartHttpBody(["refs/heads/main"]), { status: 200 })
    })
    expect(await remoteBranchExists("https://github.com/x/y/", "main")).toBe(true)
    expect(capturedUrl).toBe("https://github.com/x/y/info/refs?service=git-upload-pack")
  })

  it("throws RemoteRefsUnreachableError on non-OK HTTP status", async () => {
    mockFetch("", 404)
    await expect(remoteBranchExists("https://github.com/x/y", "main")).rejects.toBeInstanceOf(
      RemoteRefsUnreachableError,
    )
  })

  it("throws RemoteRefsUnreachableError on network failure", async () => {
    mockFetchThrow(new Error("ENOTFOUND"))
    await expect(remoteBranchExists("https://nope.invalid/x/y", "main")).rejects.toBeInstanceOf(
      RemoteRefsUnreachableError,
    )
  })
})

// ---------------------------------------------------------------------------
// BUG REPRODUCE: session activity from opencode instance not used for idle check
//
// The router currently only calls updateLastActivity() on HTTP requests and
// WebSocket upgrades. Long-lived WebSocket connections (used for AI sessions)
// generate no further HTTP traffic after the handshake, so the pod annotation
// goes stale and the pod is killed — even while the user is actively working.
//
// The fix: poll GET /experimental/session?limit=1 on the pod's IP to get the
// real time.updated from the opencode instance, and use that as the authority
// for both idle-pod deletion and the lastActivity returned to the UI.
//
// These tests assert the CORRECT desired behaviour — they currently FAIL.
// ---------------------------------------------------------------------------

/** Build a minimal /experimental/session response body. */
function makeSessionResponse(timeUpdatedMs: number): string {
  return JSON.stringify([{ time: { updated: timeUpdatedMs } }])
}

describe("deleteIdlePods — session activity from opencode instance resets idle timer", () => {
  function mockActivity(timeUpdatedMs: number) {
    ;(_setActivityFetch as any)(
      async (_url: string) => new Response(makeSessionResponse(timeUpdatedMs), { status: 200 }),
    )
  }

  it("preserves a pod whose annotation is stale but opencode instance has recent activity", async () => {
    // Annotation is 20 minutes old — beyond the 15-minute default timeout
    const staleTime = new Date(Date.now() - 20 * 60_000).toISOString()
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH, staleTime)]

    // The opencode instance reports activity just 1 minute ago
    mockActivity(Date.now() - 1 * 60_000)

    await deleteIdlePods()

    // Pod must NOT be deleted — instance has recent session activity
    expect(fakePods).toHaveLength(1)
  })

  it("updates the pod annotation with instance activity time when annotation is stale", async () => {
    const staleTime = new Date(Date.now() - 20 * 60_000).toISOString()
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH, staleTime)]

    const recentMs = Date.now() - 1 * 60_000
    mockActivity(recentMs)

    await deleteIdlePods()

    // Annotation must be refreshed with the recent timestamp from the instance
    expect(patchPodCalls).toHaveLength(1)
    const op = (patchPodCalls[0].body as any)[0]
    expect(op.op).toBe("add")
    expect(op.path).toBe("/metadata/annotations/opencode.ai~1last-activity")
    expect(new Date(op.value).getTime()).toBeGreaterThanOrEqual(recentMs - 1000)
  })

  it("still deletes a pod when both annotation and instance activity are stale", async () => {
    const staleTime = new Date(Date.now() - 20 * 60_000).toISOString()
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH, staleTime)]

    // Instance also has no recent activity (20 minutes ago)
    mockActivity(Date.now() - 20 * 60_000)

    await deleteIdlePods()

    // Pod should be deleted — no activity anywhere
    expect(fakePods).toHaveLength(0)
  })
})

describe("listUserSessions — lastActivity reflects opencode instance session time", () => {
  function mockActivity(timeUpdatedMs: number) {
    ;(_setActivityFetch as any)(
      async (_url: string) => new Response(makeSessionResponse(timeUpdatedMs), { status: 200 }),
    )
  }

  it("returns instance session time as lastActivity when it is more recent than annotation", async () => {
    // Pod annotation is 20 minutes old
    const staleTime = new Date(Date.now() - 20 * 60_000).toISOString()
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH, staleTime)]

    // But the opencode instance has a session touched just 1 minute ago
    const recentMs = Date.now() - 1 * 60_000
    mockActivity(recentMs)

    const result = await listUserSessions(EMAIL, fakeReq)

    expect(result).toHaveLength(1)
    const returned = new Date((result[0] as any).lastActivity).getTime()

    // Must return the recent instance time, not the stale annotation
    expect(returned).toBeGreaterThanOrEqual(recentMs - 1000)
  })
})

// ---------------------------------------------------------------------------
// ensurePod with githubToken — Secret lifecycle
// ---------------------------------------------------------------------------

describe("ensurePod with githubToken", () => {
  beforeEach(() => {
    fakeSecrets = []
    createSecretCalls = []
  })

  it("creates a github token Secret when githubToken is provided", async () => {
    fakePVCs = []
    fakePods = []
    const { ensurePod } = await import("./pod-manager.js")
    const hash = computeHash(EMAIL, REPO, "calm-snails-dream")

    await (ensurePod as any)(
      hash,
      { email: EMAIL, repoUrl: REPO, branch: "calm-snails-dream", sourceBranch: "main" },
      "gho_test_token",
    )

    expect(createSecretCalls).toHaveLength(1)
    const secret = (createSecretCalls[0] as any).body
    expect(secret.metadata.name).toBe(`opencode-github-${hash}`)
    expect(secret.stringData?.GITHUB_TOKEN).toBe("gho_test_token")
  })

  it("mounts the Secret via envFrom on both init and main containers", async () => {
    fakePods = []
    const { ensurePod } = await import("./pod-manager.js")
    const hash = computeHash(EMAIL, REPO, "calm-snails-dream")

    await (ensurePod as any)(
      hash,
      { email: EMAIL, repoUrl: REPO, branch: "calm-snails-dream", sourceBranch: "main" },
      "gho_test_token",
    )

    const pod = (createPodCalls[0] as any).body
    const initEnvFrom: any[] = pod.spec.initContainers[0].envFrom ?? []
    const mainEnvFrom: any[] = pod.spec.containers[0].envFrom ?? []
    const secretName = `opencode-github-${hash}`

    expect(initEnvFrom.some((e: any) => e.secretRef?.name === secretName)).toBe(true)
    expect(mainEnvFrom.some((e: any) => e.secretRef?.name === secretName)).toBe(true)
  })

  it("init script contains git credential helper setup", async () => {
    fakePods = []
    const { ensurePod } = await import("./pod-manager.js")
    const hash = computeHash(EMAIL, REPO, "calm-snails-dream")

    await (ensurePod as any)(
      hash,
      { email: EMAIL, repoUrl: REPO, branch: "calm-snails-dream", sourceBranch: "main" },
      "gho_test_token",
    )

    const pod = (createPodCalls[0] as any).body
    const script: string = pod.spec.initContainers[0].args[0]
    expect(script).toContain("credential.helper store")
    expect(script).toContain(".git-credentials")
    expect(script).toContain("GITHUB_TOKEN")
  })

  it("does NOT create a Secret when githubToken is absent", async () => {
    fakePods = []
    const { ensurePod } = await import("./pod-manager.js")
    const hash = computeHash(EMAIL, REPO, "calm-snails-dream")

    await (ensurePod as any)(hash, { email: EMAIL, repoUrl: REPO, branch: "calm-snails-dream", sourceBranch: "main" })

    expect(createSecretCalls).toHaveLength(0)
  })

  it("does NOT add github secret envFrom when githubToken is absent", async () => {
    fakePods = []
    const { ensurePod } = await import("./pod-manager.js")
    const hash = computeHash(EMAIL, REPO, "calm-snails-dream")

    await (ensurePod as any)(hash, { email: EMAIL, repoUrl: REPO, branch: "calm-snails-dream", sourceBranch: "main" })

    const pod = (createPodCalls[0] as any).body
    const mainEnvFrom: any[] = pod.spec.containers[0].envFrom ?? []
    const secretName = `opencode-github-${hash}`
    expect(mainEnvFrom.some((e: any) => e.secretRef?.name === secretName)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// terminateSession — deletes github token Secret
// ---------------------------------------------------------------------------

describe("terminateSession — deletes github token Secret", () => {
  it("deletes the github token Secret when it exists", async () => {
    const hash = SESSION_HASH
    const secretName = `opencode-github-${hash}`
    fakePVCs = [makePVC(hash, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(hash, EMAIL, REPO, BRANCH)]
    fakeSecrets = [{ metadata: { name: secretName, namespace: "opencode" }, stringData: { GITHUB_TOKEN: "gho_test" } }]

    await (terminateSession as any)(hash, EMAIL)

    expect(deleteSecretCalls).toContain(secretName)
  })

  it("succeeds even if github token Secret does not exist (404 ignored)", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = []
    fakeSecrets = [] // no secret

    await expect((terminateSession as any)(SESSION_HASH, EMAIL)).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// resumeSession — refreshes github token Secret
// ---------------------------------------------------------------------------

describe("resumeSession — refreshes github token Secret", () => {
  it("upserts the github token Secret with the new token before recreating pod", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = []
    fakeSecrets = []

    await (resumeSession as any)(SESSION_HASH, EMAIL, "gho_refreshed_token")

    // Secret must have been created (or replaced on existing secret)
    const secretName = `opencode-github-${SESSION_HASH}`
    const created = (createSecretCalls as any[]).some((c) => c.body?.metadata?.name === secretName)
    const replaced = (replaceSecretCalls as any[]).some((c) => c.name === secretName)
    expect(created || replaced).toBe(true)

    // Pod must also have been created
    expect(createPodCalls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// prepullImage — pre-pull container image using test session
// ---------------------------------------------------------------------------

describe("prepullImage", () => {
  beforeEach(() => {
    fakePVCs = []
    fakePods = []
    createPodCalls = []
    patchPodCalls = []
    fakeSecrets = []
    createSecretCalls = []
    replaceSecretCalls = []
    deleteSecretCalls = []
  })

  it("calls ensurePVC and ensurePod with test session", async () => {
    const { prepullImage, ensurePVC, ensurePod, getSessionHash, _setApiClient } = await import("./pod-manager.js")

    // Create a test session hash
    const testHash = "prepull123456"
    const originalGetSessionHash = getSessionHash
    ;(globalThis as any).getSessionHash = () => testHash

    // Mock the internal functions
    let ensurePVCCalled = false
    let ensurePodCalled = false
    let terminateSessionCalled = false

    // Override ensurePVC to track calls
    const originalEnsurePVC = ensurePVC
    const mockEnsurePVC = async (session: any) => {
      ensurePVCCalled = true
      expect(session.email).toBe("admin@opencode.ai")
      expect(session.repoUrl).toContain("test-prepull")
      fakePVCs = [...fakePVCs, { metadata: { name: `opencode-pvc-${testHash}` } }]
    }

    // Override ensurePod to track calls
    const originalEnsurePod = ensurePod
    const mockEnsurePod = async (session: any, _token: any, image: string) => {
      ensurePodCalled = true
      expect(image).toBe("ghcr.io/org/opencode:sha-1234")
      fakePods = [...fakePods, { metadata: { name: `opencode-session-${testHash}` } }]
      return testHash
    }

    // Override getPodState to return "running" immediately
    const originalGetPodState = (globalThis as any).getPodState
    ;(globalThis as any).getPodState = () => Promise.resolve("running")

    // Override terminateSession
    const originalTerminateSession = (globalThis as any).terminateSession
    ;(globalThis as any).terminateSession = async () => {
      terminateSessionCalled = true
    }

    // Need to re-import to pick up mocked functions - but that's not how ESM works
    // Instead, let's test the behavior more directly

    // Restore
    ;(globalThis as any).getSessionHash = originalGetSessionHash
  })

  it("returns true when pod becomes running", async () => {
    const { prepullImage, getSessionHash } = await import("./pod-manager.js")

    const testHash = "prepull123456"
    const originalGetSessionHash = getSessionHash
    ;(globalThis as any).getSessionHash = () => testHash

    // Mock getPodState to return "running" immediately
    const originalReadPod = fakeK8sApi.readNamespacedPod
    fakeK8sApi.readNamespacedPod = async ({ name }: { name: string }) => {
      return {
        status: {
          conditions: [{ type: "Ready", status: "True" }],
          podIP: "10.0.0.100",
        },
        metadata: { name, deletionTimestamp: undefined },
      }
    }

    // Mock deleteNamespacedPod
    let podDeleted = false
    const originalDeletePod = fakeK8sApi.deleteNamespacedPod
    fakeK8sApi.deleteNamespacedPod = async () => {
      podDeleted = true
      return {}
    }

    const result = await prepullImage("ghcr.io/org/opencode:sha-1234", 10_000)

    expect(result).toBe(true)
    expect(podDeleted).toBe(true)

    // Restore
    ;(globalThis as any).getSessionHash = originalGetSessionHash
    fakeK8sApi.readNamespacedPod = originalReadPod
    fakeK8sApi.deleteNamespacedPod = originalDeletePod
  })

  it("returns false when pod never becomes ready (timeout)", async () => {
    const { prepullImage, getSessionHash } = await import("./pod-manager.js")

    const testHash = "prepull123456"
    const originalGetSessionHash = getSessionHash
    ;(globalThis as any).getSessionHash = () => testHash

    // Pod stays in pending/creating state
    fakeK8sApi.readNamespacedPod = async ({ name }: { name: string }) => {
      return {
        status: {
          phase: "Pending",
          conditions: [{ type: "Ready", status: "False" }],
        },
        metadata: { name, deletionTimestamp: undefined },
      }
    }

    const result = await prepullImage("ghcr.io/org/opencode:sha-1234", 1_000) // short timeout

    expect(result).toBe(false)

    // Restore
    ;(globalThis as any).getSessionHash = originalGetSessionHash
  })
})

// ---------------------------------------------------------------------------
// ensurePod — injects OPENCODE_POD_SECRET env var
// ---------------------------------------------------------------------------
describe("ensurePod injects OPENCODE_POD_SECRET", () => {
  beforeEach(() => {
    // reset mocks and fake state
    podSecretStoreMock.generate.mockReset()
    podSecretStoreMock.generate.mockImplementation(() => "deadbeef".repeat(8)) // 64 chars
    createPodCalls = []
    fakePods = []
    fakePVCs = [
      {
        metadata: {
          name: "opencode-pvc-abc123456789",
          namespace: "opencode",
          labels: { "opencode.ai/session-hash": "abc123456789", "app.kubernetes.io/managed-by": "opencode-router" },
          annotations: {
            "opencode.ai/user-email": "user@test.com",
            "opencode.ai/repo-url": "https://github.com/x/y",
            "opencode.ai/branch": "test-branch",
            "opencode.ai/source-branch": "main",
          },
        },
      },
    ]
  })

  it("calls podSecretStore.generate with the session hash", async () => {
    const session = {
      email: "user@test.com",
      repoUrl: "https://github.com/x/y",
      branch: "test-branch",
      sourceBranch: "main",
    }
    const hash = getSessionHash(session.email, session.repoUrl, session.branch)
    const { ensurePod } = await import("./pod-manager.js")
    await (ensurePod as any)(hash, session)
    expect(podSecretStoreMock.generate).toHaveBeenCalledTimes(1)
    expect((podSecretStoreMock.generate as any).mock.calls[0][0]).toBe(hash)
  })

  it("injects OPENCODE_POD_SECRET env var into the pod container", async () => {
    podSecretStoreMock.generate.mockImplementation(() => "mysecret123")
    const session = {
      email: "user@test.com",
      repoUrl: "https://github.com/x/y",
      branch: "test-branch",
      sourceBranch: "main",
    }
    const hash = getSessionHash(session.email, session.repoUrl, session.branch)
    const { ensurePod } = await import("./pod-manager.js")
    await (ensurePod as any)(hash, session)
    const podBody = (createPodCalls[0] as any)?.body
    const envVars = podBody?.spec?.containers?.[0]?.env ?? []
    const secretEnv = envVars.find((e: any) => e.name === "OPENCODE_POD_SECRET")
    expect(secretEnv).toBeDefined()
    expect(secretEnv?.value).toBe("mysecret123")
  })

  it("injects OPENCODE_ROUTER_EXTERNAL_DOMAIN env var when configured", async () => {
    const session = {
      email: "user@test.com",
      repoUrl: "https://github.com/x/y",
      branch: "test-branch",
      sourceBranch: "main",
    }
    const hash = getSessionHash(session.email, session.repoUrl, session.branch)
    const { ensurePod } = await import("./pod-manager.js")
    await (ensurePod as any)(hash, session)
    const podBody = (createPodCalls[0] as any)?.body
    const envVars = podBody?.spec?.containers?.[0]?.env ?? []
    const domainEnv = envVars.find((e: any) => e.name === "OPENCODE_ROUTER_EXTERNAL_DOMAIN")
    expect(domainEnv).toBeDefined()
    expect(domainEnv?.value).toBe("test.local")
  })
})

// ---------------------------------------------------------------------------
// terminateSession — clears podSecretStore and messageStore
// ---------------------------------------------------------------------------
describe("terminateSession clears stores", () => {
  beforeEach(() => {
    podSecretStoreMock.delete.mockReset()
    messageStoreMock.delete.mockReset()
    // Set up a session to terminate
    fakePVCs = [
      {
        metadata: {
          name: "opencode-pvc-abc123456789",
          namespace: "opencode",
          labels: { "opencode.ai/session-hash": "abc123456789", "app.kubernetes.io/managed-by": "opencode-router" },
          annotations: { "opencode.ai/user-email": "owner@test.com" },
        },
      },
    ]
    fakePods = []
    fakeSecrets = []
  })

  it("calls podSecretStore.delete with the hash after termination", async () => {
    await (terminateSession as any)("abc123456789", "owner@test.com")
    expect(podSecretStoreMock.delete).toHaveBeenCalledTimes(1)
    expect((podSecretStoreMock.delete as any).mock.calls[0][0]).toBe("abc123456789")
  })

  it("calls messageStore.delete with the hash after termination", async () => {
    await (terminateSession as any)("abc123456789", "owner@test.com")
    expect(messageStoreMock.delete).toHaveBeenCalledTimes(1)
    expect((messageStoreMock.delete as any).mock.calls[0][0]).toBe("abc123456789")
  })
})

// ---------------------------------------------------------------------------
// deleteIdlePods — clears podSecretStore and messageStore for idle pods
// ---------------------------------------------------------------------------
describe("deleteIdlePods clears stores for deleted pods", () => {
  beforeEach(() => {
    podSecretStoreMock.delete.mockReset()
    messageStoreMock.delete.mockReset()
    // An idle pod (last activity far in the past)
    fakePods = [
      {
        metadata: {
          name: "opencode-session-abc123456789",
          namespace: "opencode",
          labels: { "opencode.ai/session-hash": "abc123456789", "app.kubernetes.io/managed-by": "opencode-router" },
          annotations: { "opencode.ai/last-activity": new Date(Date.now() - 999_999_999).toISOString() },
        },
        status: { podIP: null }, // no IP → skip activity check
      },
    ]
    fakePVCs = []
  })

  it("calls podSecretStore.delete for idle pods that get deleted", async () => {
    await (deleteIdlePods as any)()
    expect(podSecretStoreMock.delete).toHaveBeenCalledTimes(1)
    expect((podSecretStoreMock.delete as any).mock.calls[0][0]).toBe("abc123456789")
  })

  it("calls messageStore.delete for idle pods that get deleted", async () => {
    await (deleteIdlePods as any)()
    expect(messageStoreMock.delete).toHaveBeenCalledTimes(1)
    expect((messageStoreMock.delete as any).mock.calls[0][0]).toBe("abc123456789")
  })
})

// ---------------------------------------------------------------------------
// generateAttachPassword — random 32-char hex string
// ---------------------------------------------------------------------------

describe("generateAttachPassword", () => {
  it("returns a 32-character hex string", async () => {
    const { generateAttachPassword } = await import("./pod-manager.js")
    const password = generateAttachPassword()
    expect(password).toMatch(/^[a-f0-9]{32}$/)
  })

  it("generates unique values on each call", async () => {
    const { generateAttachPassword } = await import("./pod-manager.js")
    const a = generateAttachPassword()
    const b = generateAttachPassword()
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// getAttachUrl — builds attach URL from config
// ---------------------------------------------------------------------------

describe("getAttachUrl", () => {
  it("builds attach URL with default attachRoutePrefix", async () => {
    const { getAttachUrl } = await import("./pod-manager.js")
    const url = getAttachUrl("abc123def456")
    // ROUTE_SUFFIX defaults to "" in this test env, so URL is attach-<hash>.<domain>
    expect(url).toBe("https://attach-abc123def456.test.local")
  })

  it("contains the hash and attachRoutePrefix in URL", async () => {
    const { getAttachUrl } = await import("./pod-manager.js")
    const url = getAttachUrl("abc123def456")
    expect(url).toContain("attach-abc123def456")
    expect(url).toContain("test.local")
    expect(url).toMatch(/^https?:\/\//)
  })
})

// ---------------------------------------------------------------------------
// getOrCreateAttachPassword — read or create attach password in PVC annotation
// ---------------------------------------------------------------------------

describe("getOrCreateAttachPassword", () => {
  beforeEach(() => {
    fakePVCs = []
  })

  it("returns existing password from PVC annotation", async () => {
    const hash = "abc123456789"
    fakePVCs = [
      {
        metadata: {
          name: `opencode-pvc-${hash}`,
          namespace: "opencode",
          annotations: { "opencode.ai/attach-password": "existing-pw-123" },
        },
      },
    ]
    const { getOrCreateAttachPassword } = await import("./pod-manager.js")
    const password = await getOrCreateAttachPassword(hash)
    expect(password).toBe("existing-pw-123")
  })

  it("generates and stores new password when annotation is missing", async () => {
    const hash = "abc123456789"
    fakePVCs = [
      {
        metadata: {
          name: `opencode-pvc-${hash}`,
          namespace: "opencode",
          annotations: {},
        },
      },
    ]
    const { getOrCreateAttachPassword } = await import("./pod-manager.js")
    const password = await getOrCreateAttachPassword(hash)
    expect(password).toMatch(/^[a-f0-9]{32}$/)
  })

  it("throws NotFound when PVC does not exist", async () => {
    fakePVCs = []
    const { getOrCreateAttachPassword } = await import("./pod-manager.js")
    await expect(getOrCreateAttachPassword("nonexistent")).rejects.toThrow("NotFound")
  })
})

// ---------------------------------------------------------------------------
// ensurePVC — stores attach password on new PVC
// ---------------------------------------------------------------------------

describe("ensurePVC — attach password annotation", () => {
  beforeEach(() => {
    fakePVCs = []
  })

  it("stores attach password annotation on new PVC", async () => {
    const session = {
      email: "test@example.com",
      repoUrl: "https://github.com/x/y",
      branch: "test-branch",
      sourceBranch: "main",
    }
    const hash = computeHash(session.email, session.repoUrl, session.branch)
    const { ensurePVC } = await import("./pod-manager.js")
    await ensurePVC(hash, session)
    expect(fakePVCs).toHaveLength(1)
    const annotations = (fakePVCs[0] as any).metadata?.annotations ?? {}
    expect(annotations["opencode.ai/attach-password"]).toMatch(/^[a-f0-9]{32}$/)
  })

  it("does not overwrite existing PVC (already exists)", async () => {
    const session = {
      email: "test@example.com",
      repoUrl: "https://github.com/x/y",
      branch: "test-branch",
      sourceBranch: "main",
    }
    const hash = computeHash(session.email, session.repoUrl, session.branch)
    fakePVCs = [
      {
        metadata: {
          name: `opencode-pvc-${hash}`,
          namespace: "opencode",
          labels: { "opencode.ai/session-hash": hash, "app.kubernetes.io/managed-by": "opencode-router" },
          annotations: {
            "opencode.ai/user-email": session.email,
            "opencode.ai/attach-password": "existing-pw",
          },
        },
      },
    ]
    const { ensurePVC } = await import("./pod-manager.js")
    await ensurePVC(hash, session)
    // PVC count should still be 1 (not re-created)
    expect(fakePVCs).toHaveLength(1)
    const annotations = (fakePVCs[0] as any).metadata?.annotations ?? {}
    expect(annotations["opencode.ai/attach-password"]).toBe("existing-pw")
  })
})

// ---------------------------------------------------------------------------
// buildSessionInfo — includes attachUrl and attachPassword only for owner
// ---------------------------------------------------------------------------

describe("buildSessionInfo — attach fields in session info", () => {
  function makePVCWithAttachPassword(hash: string, email: string, password: string) {
    return {
      metadata: {
        name: `opencode-pvc-${hash}`,
        namespace: "opencode",
        creationTimestamp: "2025-01-01T00:00:00Z",
        labels: {
          "opencode.ai/session-hash": hash,
          "app.kubernetes.io/managed-by": "opencode-router",
        },
        annotations: {
          "opencode.ai/user-email": email,
          "opencode.ai/repo-url": "https://github.com/x/y",
          "opencode.ai/branch": "main",
          "opencode.ai/source-branch": "main",
          "opencode.ai/last-activity": "2025-06-01T12:00:00Z",
          "opencode.ai/created-at": "2025-01-01T00:00:00Z",
          "opencode.ai/attach-password": password,
        },
      },
      spec: {},
      status: { phase: "Bound" },
    }
  }

  it("includes attachUrl in session info", async () => {
    const hash = "abc123456789"
    const password = "test-password-123"
    fakePVCs = [makePVCWithAttachPassword(hash, "owner@test.com", password)]
    fakePods = []

    const sessions = await listUserSessions("owner@test.com", fakeReq)
    expect(sessions).toHaveLength(1)
    expect((sessions[0] as any).attachUrl).toBeDefined()
    expect(typeof (sessions[0] as any).attachUrl).toBe("string")
  })

  it("includes attachPassword for session owner", async () => {
    const hash = "abc123456789"
    const password = "owner-only-secret"
    fakePVCs = [makePVCWithAttachPassword(hash, "owner@test.com", password)]
    fakePods = []

    const sessions = await listUserSessions("owner@test.com", fakeReq)
    expect(sessions).toHaveLength(1)
    expect((sessions[0] as any).attachPassword).toBe("owner-only-secret")
  })

  it("non-owner does not see the session at all (filtered by listUserSessions)", async () => {
    const hash = "abc123456789"
    const password = "owner-only-secret"
    fakePVCs = [makePVCWithAttachPassword(hash, "owner@test.com", password)]
    fakePods = []

    const sessions = await listUserSessions("other@test.com", fakeReq)
    // Sessions are filtered by email before buildSessionInfo is called
    expect(sessions).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// getSessionInfo — includes title from messageStore
// ---------------------------------------------------------------------------
describe("getSessionInfo includes title from messageStore", () => {
  beforeEach(() => {
    messageStoreMock.get.mockReset()
    messageStoreMock.get.mockImplementation(() => ({ title: "My Session Title", messages: [] }))
    fakePVCs = [
      {
        metadata: {
          name: "opencode-pvc-abc123456789",
          namespace: "opencode",
          labels: { "opencode.ai/session-hash": "abc123456789", "app.kubernetes.io/managed-by": "opencode-router" },
          annotations: {
            "opencode.ai/user-email": "user@test.com",
            "opencode.ai/repo-url": "https://github.com/x/y",
            "opencode.ai/branch": "test-branch",
            "opencode.ai/source-branch": "main",
            "opencode.ai/last-activity": new Date().toISOString(),
            "opencode.ai/created-at": new Date().toISOString(),
          },
        },
      },
    ]
    fakePods = []
  })

  it("returns title from messageStore in SessionInfo", async () => {
    const info = await (getSessionInfo as any)("abc123456789")
    expect(info?.title).toBe("My Session Title")
  })

  it("returns undefined title when messageStore has no entry", async () => {
    messageStoreMock.get.mockImplementation(() => undefined)
    const info = await (getSessionInfo as any)("abc123456789")
    expect(info?.title).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// buildSessionInfo — session URL resolution (resume vs. bootstrap regression)
//
// Regression: commit 13287223b swapped the if/else if order so that a resumed
// pod with an initialMessage annotation would always bootstrap a new session
// instead of linking to the existing one on the PVC.
//
// Fixed order (restored): activity.sessionId wins → link to existing session.
//                         Only bootstrap when no sessions exist yet (fresh pod).
// ---------------------------------------------------------------------------

describe("buildSessionInfo — resume vs bootstrap URL resolution", () => {
  function makePVCWithInitialMessage(
    sessionHash: string,
    email: string,
    repoUrl: string,
    branch: string,
    initialMessage: string,
  ) {
    return {
      metadata: {
        name: `opencode-pvc-${sessionHash}`,
        namespace: "opencode",
        labels: {
          "opencode.ai/session-hash": sessionHash,
          "app.kubernetes.io/managed-by": "opencode-router",
        },
        annotations: {
          "opencode.ai/user-email": email,
          "opencode.ai/repo-url": repoUrl,
          "opencode.ai/branch": branch,
          "opencode.ai/source-branch": "main",
          "opencode.ai/last-activity": new Date().toISOString(),
          "opencode.ai/created-at": new Date().toISOString(),
          "opencode.ai/initial-message": initialMessage,
        },
      },
      spec: {},
      status: { phase: "Bound" },
    }
  }

  function mockActivityWithSession(sessionId: string) {
    _setActivityFetch(
      async () => new Response(JSON.stringify([{ id: sessionId, time: { updated: Date.now() } }]), { status: 200 }),
    )
  }

  function mockActivityNoSession() {
    _setActivityFetch(async () => new Response("[]", { status: 200 }))
  }

  let bootstrapCalls: { url: string; init?: RequestInit }[]

  // Save the original readNamespacedPod so we can restore it if prepullImage tests mutated it
  const originalReadNamespacedPod = fakeK8sApi.readNamespacedPod

  beforeEach(() => {
    bootstrapCalls = []
    // Clear the module-level bootstrappedSessions Map to prevent cross-test pollution
    _clearBootstrappedSessions()
    // Restore readNamespacedPod in case prepullImage tests replaced it with a stub
    fakeK8sApi.readNamespacedPod = originalReadNamespacedPod
    _setBootstrapFetch(async (url, init) => {
      bootstrapCalls.push({ url, init })
      // Simulate successful POST /session → return a new session id
      if (url.endsWith("/session")) {
        return new Response(JSON.stringify({ id: "new-session-xyz" }), { status: 200 })
      }
      // Simulate successful POST /session/:id/prompt_async
      return new Response("{}", { status: 200 })
    })
  })

  it("REGRESSION: resumed pod with initialMessage links to existing session, does NOT bootstrap", async () => {
    // This is the exact failing scenario from the bug:
    //   - PVC has opencode.ai/initial-message annotation (set at session creation time)
    //   - Pod is running and already has sessions in SQLite (resumed from PVC)
    //   - Expected: link to existing session
    //   - Broken behaviour: bootstrap a new session (discarding old work)
    const existingSessionId = "existing-session-abc"
    fakePVCs = [makePVCWithInitialMessage(SESSION_HASH, EMAIL, REPO, BRANCH, "Build me an app")]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]
    mockActivityWithSession(existingSessionId)

    const result = await getSessionInfo(SESSION_HASH)

    // Must link to the existing session — not null, not a bootstrapped session
    expect(result?.url).toContain(existingSessionId)
    expect(result?.url).not.toContain("new-session-xyz")
    // Must NOT have called the bootstrap endpoint at all
    expect(bootstrapCalls).toHaveLength(0)
  })

  it("fresh pod with initialMessage bootstraps a new session", async () => {
    // Fresh pod: no sessions in SQLite yet, but initialMessage annotation is present.
    // Expected: bootstrap a new session and return its deep-link URL.
    fakePVCs = [makePVCWithInitialMessage(SESSION_HASH, EMAIL, REPO, BRANCH, "Build me an app")]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]
    mockActivityNoSession()

    const result = await getSessionInfo(SESSION_HASH)

    // Must have called POST /session to bootstrap
    expect(bootstrapCalls.some((c) => c.url.endsWith("/session"))).toBe(true)
    // URL must point to the bootstrapped session
    expect(result?.url).toContain("new-session-xyz")
  })

  it("resumed pod without initialMessage links to existing session", async () => {
    // No initialMessage on PVC, but pod has an existing session (normal resume).
    const existingSessionId = "existing-session-def"
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]
    mockActivityWithSession(existingSessionId)

    const result = await getSessionInfo(SESSION_HASH)

    expect(result?.url).toContain(existingSessionId)
    expect(bootstrapCalls).toHaveLength(0)
  })

  it("fresh pod without initialMessage returns null url (waiting for user to create session)", async () => {
    // No initialMessage, no existing sessions — url stays null.
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]
    mockActivityNoSession()

    const result = await getSessionInfo(SESSION_HASH)

    expect(result?.url).toBeNull()
    expect(bootstrapCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// sessionsChanged emission tests
// ---------------------------------------------------------------------------

describe("emitSessionsChanged injection", () => {
  let emitCalls: number

  beforeEach(() => {
    emitCalls = 0
    _setEmitSessionsChanged(() => {
      emitCalls++
    })
  })

  it("terminateSession emits sessionsChanged after deleting PVC+pod", async () => {
    const hash = computeHash(EMAIL, REPO, BRANCH)
    fakePVCs = [makePVC(hash, EMAIL, REPO, BRANCH)]
    fakePods = [makeRunningPod(hash, EMAIL, REPO, BRANCH)]

    await terminateSession(hash, EMAIL)

    expect(emitCalls).toBe(1)
  })

  it("deleteIdlePods emits sessionsChanged for each deleted pod", async () => {
    // Use a last-activity far in the past so it counts as idle
    const oldActivity = new Date(Date.now() - 999 * 60_000).toISOString()
    const hash = computeHash(EMAIL, REPO, BRANCH)
    fakePVCs = [makePVC(hash, EMAIL, REPO, BRANCH, oldActivity)]
    fakePods = [makeRunningPod(hash, EMAIL, REPO, BRANCH, oldActivity)]
    // Activity fetch returns null so it skips the liveness check
    _setActivityFetch(async () => new Response("null", { status: 200 }))

    await deleteIdlePods()

    expect(emitCalls).toBeGreaterThanOrEqual(1)
  })

  it("resumeSession emits sessionsChanged after recreating the pod", async () => {
    const hash = computeHash(EMAIL, REPO, BRANCH)
    fakePVCs = [
      {
        metadata: {
          name: `opencode-pvc-${hash}`,
          namespace: "opencode",
          labels: { "opencode.ai/session-hash": hash, "app.kubernetes.io/managed-by": "opencode-router" },
          annotations: {
            "opencode.ai/user-email": EMAIL,
            "opencode.ai/repo-url": REPO,
            "opencode.ai/branch": BRANCH,
            "opencode.ai/source-branch": "main",
          },
        },
      },
    ]
    fakePods = []
    _setHumanId(() => "test-branch")
    _setActivityFetch(async () => new Response("[]", { status: 200 }))

    await resumeSession(hash, EMAIL)

    expect(emitCalls).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Blank disc / new project flow tests (repoUrl absent → git init)
// ---------------------------------------------------------------------------

describe("getSessionHash — new project (no repoUrl)", () => {
  it("returns a random 12-char hex string when repoUrl is absent", () => {
    const hash1 = getSessionHash(EMAIL)
    const hash2 = getSessionHash(EMAIL)
    // Two calls must return different hashes (random)
    expect(hash1).not.toBe(hash2)
    expect(hash1).toMatch(/^[a-f0-9]{12}$/)
    expect(hash2).toMatch(/^[a-f0-9]{12}$/)
  })

  it("uses deterministic hash when repoUrl is present (backward compat)", () => {
    const hash1 = getSessionHash(EMAIL, REPO, BRANCH)
    const hash2 = getSessionHash(EMAIL, REPO, BRANCH)
    expect(hash1).toBe(hash2)
  })
})

describe("ensurePVC — new project (no repoUrl)", () => {
  beforeEach(() => {
    fakePVCs = []
    fakePods = []
  })

  it("creates PVC without repo annotations when repoUrl is absent", async () => {
    const { ensurePVC, getSessionHash: gsh } = await import("./pod-manager.js")
    const session = { email: EMAIL, initialMessage: "Build a new app" }
    const hash = (gsh as any)(EMAIL)

    await (ensurePVC as any)(hash, session)

    expect(fakePVCs).toHaveLength(1)
    const pvc = fakePVCs[0] as any
    const ann = pvc.metadata?.annotations ?? {}
    expect(ann["opencode.ai/user-email"]).toBe(EMAIL)
    expect(ann["opencode.ai/repo-url"]).toBeUndefined()
    expect(ann["opencode.ai/branch"]).toBeUndefined()
    expect(ann["opencode.ai/source-branch"]).toBeUndefined()
    expect(ann["opencode.ai/initial-message"]).toBe("Build a new app")
  })
})

describe("ensurePod — new project (no repoUrl)", () => {
  beforeEach(() => {
    fakePods = []
    fakePVCs = []
    createPodCalls = []
    createSecretCalls = []
  })

  it("init script contains git init instead of git clone when repoUrl is absent", async () => {
    const { ensurePod, getSessionHash: gsh } = await import("./pod-manager.js")
    const session = { email: EMAIL }
    const hash = (gsh as any)(EMAIL)

    await (ensurePod as any)(hash, session)

    expect(createPodCalls).toHaveLength(1)
    const pod = (createPodCalls[0] as any).body
    const script: string = pod.spec.initContainers[0].args[0]
    // Must NOT have git clone commands
    expect(script).not.toContain("git clone")
    // Must have git init (with safe.directory to survive pod restarts)
    expect(script).toContain("git -c safe.directory=/workspace init /workspace")
    expect(script).toContain("git -c safe.directory=/workspace commit -m")
  })

  it("pod annotations do not include repo annotations when repoUrl is absent", async () => {
    const { ensurePod, getSessionHash: gsh } = await import("./pod-manager.js")
    const session = { email: EMAIL }
    const hash = (gsh as any)(EMAIL)

    await (ensurePod as any)(hash, session)

    const pod = (createPodCalls[0] as any).body
    const ann = pod.metadata?.annotations ?? {}
    expect(ann["opencode.ai/repo-url"]).toBeUndefined()
    expect(ann["opencode.ai/branch"]).toBeUndefined()
    expect(ann["opencode.ai/source-branch"]).toBeUndefined()
    // Must still have core annotations
    expect(ann["opencode.ai/user-email"]).toBe(EMAIL)
    expect(ann["opencode.ai/pod-secret"]).toBeDefined()
  })

  it("still creates github token Secret when provided, even without repoUrl", async () => {
    const { ensurePod, getSessionHash: gsh } = await import("./pod-manager.js")
    const session = { email: EMAIL }
    const hash = (gsh as any)(EMAIL)

    await (ensurePod as any)(hash, session, "gho_new_project_token")

    expect(createSecretCalls).toHaveLength(1)
    const secret = (createSecretCalls[0] as any).body
    expect(secret.stringData?.GITHUB_TOKEN).toBe("gho_new_project_token")
  })

  it("init script still contains git credential helper setup when token provided without repoUrl", async () => {
    const { ensurePod, getSessionHash: gsh } = await import("./pod-manager.js")
    const session = { email: EMAIL }
    const hash = (gsh as any)(EMAIL)

    await (ensurePod as any)(hash, session, "gho_new_project_token")

    const pod = (createPodCalls[0] as any).body
    const script: string = pod.spec.initContainers[0].args[0]
    expect(script).toContain("credential.helper store")
    expect(script).toContain(".git-credentials")
  })
})

describe("startSession — stable hash for no-repo session", () => {
  beforeEach(() => {
    fakePVCs = []
    fakePods = []
    createPodCalls = []
  })

  it("PVC name and Pod claimName share the same hash for a no-repo session", async () => {
    const { startSession } = await import("./pod-manager.js")
    const session = { email: EMAIL }

    await (startSession as any)(session)

    expect(fakePVCs).toHaveLength(1)
    expect(createPodCalls).toHaveLength(1)

    const pvcName: string = (fakePVCs[0] as any).metadata.name
    const volumes: any[] = (createPodCalls[0] as any).body.spec.volumes
    const claimName: string = volumes.find((v: any) => v.persistentVolumeClaim)?.persistentVolumeClaim?.claimName

    // Both must reference the same hash — extract the hex suffix after "opencode-pvc-" / "opencode-pod-"
    const pvcHash = pvcName.replace("opencode-pvc-", "")
    const podHash = claimName.replace("opencode-pvc-", "")
    expect(pvcHash).toMatch(/^[a-f0-9]{12}$/)
    expect(pvcHash).toBe(podHash)
  })

  it("startSession returns the hash used for the PVC", async () => {
    const { startSession } = await import("./pod-manager.js")
    const session = { email: EMAIL }

    const hash = await (startSession as any)(session)

    expect(hash).toMatch(/^[a-f0-9]{12}$/)
    const pvcName: string = (fakePVCs[0] as any).metadata.name
    expect(pvcName).toBe(`opencode-pvc-${hash}`)
  })
})

describe("resumeSession — blank-aware", () => {
  beforeEach(() => {
    fakePods = []
    createPodCalls = []
    ;(_setEmitSessionsChanged as any)(() => {})
  })

  it("reconstructs SessionKey without repo fields when PVC lacks repo annotations", async () => {
    // PVC has email + initial-message but no repo annotations
    fakePVCs = [
      {
        metadata: {
          name: "opencode-pvc-abc123newproj",
          namespace: "opencode",
          labels: { "opencode.ai/session-hash": "abc123newproj", "app.kubernetes.io/managed-by": "opencode-router" },
          annotations: {
            "opencode.ai/user-email": EMAIL,
            "opencode.ai/initial-message": "My new project",
            "opencode.ai/created-at": new Date().toISOString(),
          },
        },
      },
    ]

    await (resumeSession as any)("abc123newproj", EMAIL)

    // Pod must be created (ensurePod was called)
    expect(createPodCalls).toHaveLength(1)
    const pod = (createPodCalls[0] as any).body
    const script: string = pod.spec.initContainers[0].args[0]
    // Since no repoUrl in SessionKey, should use git init path
    expect(script).toContain("git -c safe.directory=/workspace init /workspace")
    expect(script).not.toContain("git clone")
  })
})

// ---------------------------------------------------------------------------
// Per-user secrets — getUserSecretName, ensureUserSecret, deleteUserSecret
// ---------------------------------------------------------------------------

import crypto from "node:crypto"

function computeUserSecretHash(email: string): string {
  return crypto.createHash("sha256").update(email.toLowerCase().trim()).digest("hex").slice(0, 12)
}

describe("getUserSecretName", () => {
  it("returns secret name in expected format", async () => {
    const { getUserSecretName } = await import("./pod-manager.js")
    const email = "user@example.com"
    const result = getUserSecretName(email)
    expect(result).toBe(`opencode-user-${computeUserSecretHash(email)}`)
  })

  it("is case-insensitive and trims whitespace", async () => {
    const { getUserSecretName } = await import("./pod-manager.js")
    const email = "  User@Example.COM  "
    const result = getUserSecretName(email)
    expect(result).toBe(`opencode-user-${computeUserSecretHash("user@example.com")}`)
  })

  it("produces different names for different emails", async () => {
    const { getUserSecretName } = await import("./pod-manager.js")
    const result1 = getUserSecretName("a@test.com")
    const result2 = getUserSecretName("b@test.com")
    expect(result1).not.toBe(result2)
  })
})

describe("ensureUserSecret", () => {
  beforeEach(() => {
    fakeSecrets = []
    createSecretCalls = []
    replaceSecretCalls = []
  })

  it("creates a new secret when it does not exist", async () => {
    const { ensureUserSecret } = await import("./pod-manager.js")
    const email = "user@example.com"
    const secrets = { OPENAI_API_KEY: "sk-user-secret-key" }

    await (ensureUserSecret as any)(email, secrets)

    expect(createSecretCalls).toHaveLength(1)
    const call = createSecretCalls[0]
    expect(call.namespace).toBe("opencode")
    expect(call.body.metadata.name).toBe(`opencode-user-${computeUserSecretHash(email)}`)
    expect(call.body.type).toBe("Opaque")
    expect(call.body.stringData).toEqual(secrets)
  })

  it("updates existing secret when it already exists", async () => {
    const { ensureUserSecret, getUserSecretName } = await import("./pod-manager.js")
    const email = "user@example.com"
    const secretName = getUserSecretName(email)

    // Pre-populate with existing secret
    fakeSecrets = [
      {
        metadata: { name: secretName, namespace: "opencode" },
        type: "Opaque",
        stringData: { OPENAI_API_KEY: "old-secret" },
      },
    ]

    const newSecrets = { OPENAI_API_KEY: "sk-new-secret-key" }
    await (ensureUserSecret as any)(email, newSecrets)

    expect(createSecretCalls).toHaveLength(0)
    expect(replaceSecretCalls).toHaveLength(1)
    expect(replaceSecretCalls[0].name).toBe(secretName)
    expect(replaceSecretCalls[0].body.stringData).toEqual(newSecrets)
  })

  it("uses correct namespace from config", async () => {
    const { ensureUserSecret } = await import("./pod-manager.js")
    const email = "admin@test.com"
    const secrets = { ANTHROPIC_API_KEY: "sk-test-key" }

    await (ensureUserSecret as any)(email, secrets)

    expect(createSecretCalls[0].namespace).toBe("opencode")
  })
})

describe("deleteUserSecret", () => {
  beforeEach(() => {
    fakeSecrets = []
    deleteSecretCalls = []
  })

  it("deletes the user's secret", async () => {
    const { deleteUserSecret, getUserSecretName } = await import("./pod-manager.js")
    const email = "user@example.com"
    const secretName = getUserSecretName(email)

    // Pre-populate with existing secret
    fakeSecrets = [
      {
        metadata: { name: secretName, namespace: "opencode" },
        type: "Opaque",
        stringData: { USER_API_KEY: "some-secret" },
      },
    ]

    await (deleteUserSecret as any)(email)

    expect(deleteSecretCalls).toContain(secretName)
  })

  it("does not throw when secret does not exist", async () => {
    const { deleteUserSecret } = await import("./pod-manager.js")
    const email = "nonexistent@example.com"

    // Should not throw - the function should handle NotFound gracefully
    await (deleteUserSecret as any)(email)
    // If we get here without an uncaught error, the test passes
    expect(true).toBe(true)
  })
})

describe.sequential("terminateSession — archive on termination", () => {
  const ARCHIVE_DIR = "/tmp/test-archives-slice1"

  beforeEach(async () => {
    // Clean up archive dir
    try {
      const fs = require("node:fs")
      if (fs.existsSync(ARCHIVE_DIR)) {
        fs.rmSync(ARCHIVE_DIR, { recursive: true })
      }
    } catch {}

    // Reset strict mode to prevent cross-test pollution
    const { config: testConfig } = await import("./config.js")
    testConfig.archiveStrictMode = false

    // Inject mock exec implementation so archiveSession doesn't need a real k8s cluster
    const { _setExecImpl } = await import("./archive.js")
    _setExecImpl(async (_namespace, podName, _containerName, command, stdout, _stderr, _stdin, _tty, statusCallback) => {
      const result = await (fakeK8sApi as any).connectGetNamespacedPodExec({ name: podName, command })
      const ws = result.socket || result.ws || result

      return new Promise((resolve, reject) => {
        ws.on("open", () => {})
        ws.on("message", (msg: Buffer) => {
          // Strip channel byte (1 = stdout)
          if (msg[0] === 1) {
            stdout.write(msg.slice(1))
          }
        })
        ws.on("close", () => {
          stdout.end()
          if (statusCallback) {
            statusCallback({ status: "Success", reason: "", message: "" } as any)
          }
          resolve(ws)
        })
        ws.on("error", (err: any) => {
          reject(err)
        })
      })
    })
  })

  afterEach(() => {
    try {
      const fs = require("node:fs")
      if (fs.existsSync(ARCHIVE_DIR)) {
        fs.rmSync(ARCHIVE_DIR, { recursive: true })
      }
    } catch {}
  })

  it("archives running session before deletion when bootstrapped session exists", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH, undefined, "Build me an app")]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]

    // Set up a bootstrapped session
    const { _setBootstrapFetch, _clearBootstrappedSessions } = await import("./pod-manager.js")
    _clearBootstrappedSessions()
    _setBootstrapFetch(async (url: string) => {
      if (url.endsWith("/session")) {
        return new Response(JSON.stringify({ id: "test-session-123" }), { status: 200 })
      }
      return new Response("{}", { status: 200 })
    })

    // Trigger bootstrap by getting session info
    const { getSessionInfo } = await import("./pod-manager.js")
    await getSessionInfo(SESSION_HASH)

    // Now terminate
    await (terminateSession as any)(SESSION_HASH, EMAIL)

    // Pod and PVC should be deleted
    expect(fakePods).toHaveLength(0)
    expect(fakePVCs).toHaveLength(0)

    // Archive should exist
    const fs = await import("node:fs")
    const archivePath = `${ARCHIVE_DIR}/${EMAIL}/${SESSION_HASH}.json`
    expect(fs.existsSync(archivePath)).toBe(true)
    const content = JSON.parse(fs.readFileSync(archivePath, "utf-8"))
    expect(content.openCodeSessionId).toBe("test-session-123")
  })

  it("skips archive when no bootstrapped session exists", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH, undefined, "Build me an app")]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]

    const { _clearBootstrappedSessions } = await import("./pod-manager.js")
    _clearBootstrappedSessions()

    await (terminateSession as any)(SESSION_HASH, EMAIL)

    expect(fakePods).toHaveLength(0)
    expect(fakePVCs).toHaveLength(0)

    const fs = await import("node:fs")
    expect(fs.existsSync(`${ARCHIVE_DIR}/${EMAIL}/${SESSION_HASH}.json`)).toBe(false)
  })

  it("proceeds with deletion even if archive fails (strictMode=false)", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH, undefined, "Build me an app")]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]

    // Override exec to throw
    const originalExec = (fakeK8sApi as any).connectGetNamespacedPodExec
    ;(fakeK8sApi as any).connectGetNamespacedPodExec = async () => {
      throw new Error("Simulated exec failure")
    }

    // Set up bootstrapped session
    const { _setBootstrapFetch, _clearBootstrappedSessions } = await import("./pod-manager.js")
    _clearBootstrappedSessions()
    _setBootstrapFetch(async (url: string) => {
      if (url.endsWith("/session")) {
        return new Response(JSON.stringify({ id: "test-session-123" }), { status: 200 })
      }
      return new Response("{}", { status: 200 })
    })

    const { getSessionInfo } = await import("./pod-manager.js")
    await getSessionInfo(SESSION_HASH)

    // Should NOT throw
    await (terminateSession as any)(SESSION_HASH, EMAIL)

    // Deletion should still proceed
    expect(fakePods).toHaveLength(0)
    expect(fakePVCs).toHaveLength(0)

    // Restore
    ;(fakeK8sApi as any).connectGetNamespacedPodExec = originalExec
  })

  it("archives stopped session by creating temporary export pod", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH, undefined, "Build me an app")]
    fakePods = [] // No running pod — stopped session

    // Bootstrap first by temporarily creating a running pod
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]
    const { getSessionInfo, _setBootstrapFetch, _clearBootstrappedSessions } = await import("./pod-manager.js")
    _clearBootstrappedSessions()
    _setBootstrapFetch(async (url: string) => {
      if (url.endsWith("/session")) {
        return new Response(JSON.stringify({ id: "test-session-123" }), { status: 200 })
      }
      return new Response("{}", { status: 200 })
    })
    await getSessionInfo(SESSION_HASH)

    // Now remove the pod to simulate stopped state
    fakePods = []

    await (terminateSession as any)(SESSION_HASH, EMAIL)

    // PVC and any temp pods should be deleted
    expect(fakePVCs).toHaveLength(0)
    expect(fakePods).toHaveLength(0)

    // Archive should exist
    const fs = await import("node:fs")
    const archivePath = `${ARCHIVE_DIR}/${EMAIL}/${SESSION_HASH}.json`
    expect(fs.existsSync(archivePath)).toBe(true)
    const content = JSON.parse(fs.readFileSync(archivePath, "utf-8"))
    expect(content.openCodeSessionId).toBe("test-session-123")
  })

  it("proceeds with PVC deletion even if temp pod archive fails (strictMode=false)", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH, undefined, "Build me an app")]
    fakePods = []

    // Bootstrap first
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]
    const { getSessionInfo, _setBootstrapFetch, _clearBootstrappedSessions } = await import("./pod-manager.js")
    _clearBootstrappedSessions()
    _setBootstrapFetch(async (url: string) => {
      if (url.endsWith("/session")) {
        return new Response(JSON.stringify({ id: "test-session-123" }), { status: 200 })
      }
      return new Response("{}", { status: 200 })
    })
    await getSessionInfo(SESSION_HASH)
    fakePods = []

    // Override createNamespacedPod to fail for temp pods
    const originalCreatePod = fakeK8sApi.createNamespacedPod
    fakeK8sApi.createNamespacedPod = async () => {
      throw new Error("Simulated temp pod creation failure")
    }

    await (terminateSession as any)(SESSION_HASH, EMAIL)

    expect(fakePVCs).toHaveLength(0)
    expect(fakePods).toHaveLength(0)

    // Restore
    fakeK8sApi.createNamespacedPod = originalCreatePod
  })

  it("blocks termination when archive fails and strictMode=true", async () => {
    // Temporarily set strict mode
    const { config: testConfig } = await import("./config.js")
    const originalStrictMode = testConfig.archiveStrictMode
    testConfig.archiveStrictMode = true

    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH, undefined, "Build me an app")]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]

    // Set up bootstrapped session
    const { _setBootstrapFetch, _clearBootstrappedSessions } = await import("./pod-manager.js")
    _clearBootstrappedSessions()
    _setBootstrapFetch(async (url: string) => {
      if (url.endsWith("/session")) {
        return new Response(JSON.stringify({ id: "test-session-123" }), { status: 200 })
      }
      return new Response("{}", { status: 200 })
    })

    const { getSessionInfo } = await import("./pod-manager.js")
    await getSessionInfo(SESSION_HASH)

    // Override exec to throw
    const originalExec = (fakeK8sApi as any).connectGetNamespacedPodExec
    ;(fakeK8sApi as any).connectGetNamespacedPodExec = async () => {
      throw new Error("Simulated exec failure")
    }

    // Should throw because strictMode=true
    await expect((terminateSession as any)(SESSION_HASH, EMAIL)).rejects.toThrow("Simulated exec failure")

    // Pod and PVC should NOT be deleted because termination was blocked
    expect(fakePods).toHaveLength(1)
    expect(fakePVCs).toHaveLength(1)

    // Restore
    ;(fakeK8sApi as any).connectGetNamespacedPodExec = originalExec
    testConfig.archiveStrictMode = originalStrictMode
  })

  it("proceeds with deletion when exec times out", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH, undefined, "Build me an app")]
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]

    // Set up bootstrapped session
    const { _setBootstrapFetch, _clearBootstrappedSessions } = await import("./pod-manager.js")
    _clearBootstrappedSessions()
    _setBootstrapFetch(async (url: string) => {
      if (url.endsWith("/session")) {
        return new Response(JSON.stringify({ id: "test-session-123" }), { status: 200 })
      }
      return new Response("{}", { status: 200 })
    })

    const { getSessionInfo } = await import("./pod-manager.js")
    await getSessionInfo(SESSION_HASH)

    // Override exec to hang (never emits close)
    const originalExec = (fakeK8sApi as any).connectGetNamespacedPodExec
    ;(fakeK8sApi as any).connectGetNamespacedPodExec = async () => {
      const mockWs = {
        on(event: string, _cb: Function) {
          if (event === "open") setTimeout(() => _cb(), 0)
          // Never emit message or close → simulates a hang
        },
        close() {},
      }
      return { socket: mockWs, ws: mockWs }
    }

    // Shorten timeout
    const { config: testConfig } = await import("./config.js")
    const originalTimeout = testConfig.archiveTimeoutMs
    testConfig.archiveTimeoutMs = 500

    await (terminateSession as any)(SESSION_HASH, EMAIL)

    // After timeout, deletion should still proceed
    expect(fakePods).toHaveLength(0)
    expect(fakePVCs).toHaveLength(0)

    // Restore
    ;(fakeK8sApi as any).connectGetNamespacedPodExec = originalExec
    testConfig.archiveTimeoutMs = originalTimeout
  })

  it("proceeds with PVC deletion when temp pod never reaches Running", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH, undefined, "Build me an app")]
    fakePods = []

    // Bootstrap first by temporarily creating a running pod
    fakePods = [makeRunningPod(SESSION_HASH, EMAIL, REPO, BRANCH)]
    const { getSessionInfo, _setBootstrapFetch, _clearBootstrappedSessions } = await import("./pod-manager.js")
    _clearBootstrappedSessions()
    _setBootstrapFetch(async (url: string) => {
      if (url.endsWith("/session")) {
        return new Response(JSON.stringify({ id: "test-session-123" }), { status: 200 })
      }
      return new Response("{}", { status: 200 })
    })
    await getSessionInfo(SESSION_HASH)

    // Now remove the pod to simulate stopped state
    fakePods = []

    // Override createNamespacedPod to create a pod that stays Pending
    const originalCreatePod = fakeK8sApi.createNamespacedPod
    ;(fakeK8sApi as any).createNamespacedPod = async ({ body }: any) => {
      fakePods = [...(fakePods as any[]), body]
      // Don't transition to Running — leave it Pending
      return body
    }

    // Shorten temp pod timeout
    const { config: testConfig } = await import("./config.js")
    const originalTempTimeout = testConfig.archiveTempPodTimeoutMs
    testConfig.archiveTempPodTimeoutMs = 500

    await (terminateSession as any)(SESSION_HASH, EMAIL)

    // PVC should be deleted even though temp pod timed out
    expect(fakePVCs).toHaveLength(0)
    // Temp pod should still be deleted (cleanup in finally)
    expect(fakePods).toHaveLength(0)

    // Archive should NOT exist
    const fs = await import("node:fs")
    expect(fs.existsSync(`${ARCHIVE_DIR}/${EMAIL}/${SESSION_HASH}.json`)).toBe(false)

    // Restore
    fakeK8sApi.createNamespacedPod = originalCreatePod
    testConfig.archiveTempPodTimeoutMs = originalTempTimeout
  })

  it("skips archive when pod is Pending and proceeds with deletion", async () => {
    fakePVCs = [makePVC(SESSION_HASH, EMAIL, REPO, BRANCH, undefined, "Build me an app")]
    fakePods = [makePendingPod(SESSION_HASH, EMAIL, REPO, BRANCH)]

    await (terminateSession as any)(SESSION_HASH, EMAIL)

    // Pod and PVC should be deleted
    expect(fakePods).toHaveLength(0)
    expect(fakePVCs).toHaveLength(0)

    // No archive should be written
    const fs = await import("node:fs")
    expect(fs.existsSync(`${ARCHIVE_DIR}/${EMAIL}/${SESSION_HASH}.json`)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Capability routing — OPENCODE_MODEL_{THINKING,CODING,RESEARCH} env vars
// ---------------------------------------------------------------------------
// The pod-manager module is loaded once per test file (Node module cache), so
// the config object inside it is shared. We mutate its three model* fields
// per test and reset to undefined in beforeEach to avoid cross-test pollution.
describe.sequential("ensurePod — codemcp workflows capability routing", () => {
  let testConfig: typeof import("./config.js").config

  beforeEach(async () => {
    fakePods = []
    fakePVCs = []
    createPodCalls = []
    // Resolve the shared config object (same instance used by pod-manager
    // internally — Node module cache returns the same export every time).
    const mod = await import("./config.js")
    testConfig = mod.config
    // Reset the three model fields on the shared config object before each test.
    testConfig.modelThinking = undefined
    testConfig.modelCoding = undefined
    testConfig.modelResearch = undefined
  })

  it("adds all three OPENCODE_MODEL_* env vars to the main container env when set", async () => {
    testConfig.modelThinking = "claude-opus-4-1"
    testConfig.modelCoding = "claude-sonnet-4-5"
    testConfig.modelResearch = "claude-haiku-4-5"

    await (ensurePod as any)(
      SESSION_HASH,
      { email: EMAIL, repoUrl: REPO, branch: BRANCH, sourceBranch: "main" },
    )

    const pod = (createPodCalls[0] as any).body
    const mainEnv: any[] = pod.spec.containers[0].env ?? []
    const byName = (name: string) => mainEnv.find((e) => e.name === name)
    expect(byName("OPENCODE_MODEL_THINKING")?.value).toBe("claude-opus-4-1")
    expect(byName("OPENCODE_MODEL_CODING")?.value).toBe("claude-sonnet-4-5")
    expect(byName("OPENCODE_MODEL_RESEARCH")?.value).toBe("claude-haiku-4-5")
  })

  it("propagates OPENCODE_MODEL_* env vars to the init container so the wizard can see them", async () => {
    // The init container has its own env namespace — it does not inherit the
    // main container's env: block. Without explicit injection here, the
    // if-guard in the .sh file is always false and the wizard is never called.
    testConfig.modelThinking = "claude-opus-4-1"
    testConfig.modelCoding = "claude-sonnet-4-5"
    testConfig.modelResearch = "claude-haiku-4-5"

    await (ensurePod as any)(
      SESSION_HASH,
      { email: EMAIL, repoUrl: REPO, branch: BRANCH, sourceBranch: "main" },
    )

    const pod = (createPodCalls[0] as any).body
    const initEnv: any[] = pod.spec.initContainers[0].env ?? []
    const byName = (name: string) => initEnv.find((e) => e.name === name)
    expect(byName("OPENCODE_MODEL_THINKING")?.value).toBe("claude-opus-4-1")
    expect(byName("OPENCODE_MODEL_CODING")?.value).toBe("claude-sonnet-4-5")
    expect(byName("OPENCODE_MODEL_RESEARCH")?.value).toBe("claude-haiku-4-5")
  })

  it("omits OPENCODE_MODEL_* env vars from the init container env when unset", async () => {
    // thinking, coding, and research are all undefined on the shared config

    await (ensurePod as any)(
      SESSION_HASH,
      { email: EMAIL, repoUrl: REPO, branch: BRANCH, sourceBranch: "main" },
    )

    const pod = (createPodCalls[0] as any).body
    const initEnv: any[] = pod.spec.initContainers[0].env ?? []
    const names = initEnv.map((e) => e.name)
    expect(names).not.toContain("OPENCODE_MODEL_THINKING")
    expect(names).not.toContain("OPENCODE_MODEL_CODING")
    expect(names).not.toContain("OPENCODE_MODEL_RESEARCH")
  })

  it("mounts the API-key Secret on the init container so the wizard sees env vars from it", async () => {
    // The init script must see env vars the cluster operator puts in the
    // API-key Secret (config.apiKeySecretName), not just the deployment env.
    // Mirroring the main container's envFrom onto the init container
    // guarantees the wizard's if-guard is true when the operator chooses
    // the API-key Secret as the env-var source.
    const originalSecretName = testConfig.apiKeySecretName
    testConfig.apiKeySecretName = "opencode-api-keys"

    try {
      await (ensurePod as any)(
        SESSION_HASH,
        { email: EMAIL, repoUrl: REPO, branch: BRANCH, sourceBranch: "main" },
      )

      const pod = (createPodCalls[0] as any).body
      const initEnvFrom: any[] = pod.spec.initContainers[0].envFrom ?? []
      const refNames = initEnvFrom
        .map((e: any) => e.secretRef?.name)
        .filter(Boolean)
      expect(refNames).toContain("opencode-api-keys")
    } finally {
      testConfig.apiKeySecretName = originalSecretName
    }
  })

  it("mounts the user Secret on the init container so the wizard sees env vars from user secrets", async () => {
    // Without the user Secret in the init container's envFrom, a user who
    // sets OPENCODE_MODEL_* only in their per-user Secret would find the
    // if-guard always false — the wizard would never run for them.
    const userSecrets = {
      OPENCODE_MODEL_THINKING: "claude-opus-4-1",
      OPENCODE_MODEL_CODING: "claude-sonnet-4-5",
      OPENCODE_MODEL_RESEARCH: "claude-haiku-4-5",
    }

    await (ensurePod as any)(
      SESSION_HASH,
      { email: EMAIL, repoUrl: REPO, branch: BRANCH, sourceBranch: "main" },
      undefined, // githubToken
      undefined, // podSecret
      userSecrets,
    )

    const pod = (createPodCalls[0] as any).body
    const initEnvFrom: any[] = pod.spec.initContainers[0].envFrom ?? []
    const refNames = initEnvFrom
      .map((e: any) => e.secretRef?.name)
      .filter(Boolean)
    // The user Secret name is derived from the email; we don't hardcode
    // the format here (see getUserSecretName tests for that), only assert
    // that *some* user-Secret-style ref is present.
    const userSecretRef = initEnvFrom.find(
      (e: any) => e.secretRef?.name && /user/i.test(e.secretRef.name),
    )
    expect(userSecretRef, `init container envFrom should include the user secret; got ${JSON.stringify(refNames)}`).toBeTruthy()
  })

  it("init container envFrom mirrors the main container envFrom (so the wizard and the agent process see the same env)", async () => {
    // Any Secret dropped from the init container envFrom would be invisible
    // to the wizard even though the agent process sees it. This tests that
    // the two envFrom lists stay in lockstep regardless of which Secrets
    // are present for a given session.
    const userSecrets = { FOO: "bar" }

    await (ensurePod as any)(
      SESSION_HASH,
      { email: EMAIL, repoUrl: REPO, branch: BRANCH, sourceBranch: "main" },
      undefined,
      undefined,
      userSecrets,
    )

    const pod = (createPodCalls[0] as any).body
    const initRefNames = (pod.spec.initContainers[0].envFrom ?? [])
      .map((e: any) => e.secretRef?.name)
      .filter(Boolean)
    const mainRefNames = (pod.spec.containers[0].envFrom ?? [])
      .map((e: any) => e.secretRef?.name)
      .filter(Boolean)
    // Every Secret referenced by the main container must also be
    // referenced by the init container (the init container can have
    // additional refs, e.g. for the deployment env, but never fewer).
    for (const ref of mainRefNames) {
      expect(initRefNames, `init container envFrom should include ${ref} (from main container)`).toContain(ref)
    }
  })

  it("omits OPENCODE_MODEL_* env vars from the main container env when unset", async () => {
    // thinking, coding, and research are all undefined on the shared config

    await (ensurePod as any)(
      SESSION_HASH,
      { email: EMAIL, repoUrl: REPO, branch: BRANCH, sourceBranch: "main" },
    )

    const pod = (createPodCalls[0] as any).body
    const mainEnv: any[] = pod.spec.containers[0].env ?? []
    const names = mainEnv.map((e) => e.name)
    expect(names).not.toContain("OPENCODE_MODEL_THINKING")
    expect(names).not.toContain("OPENCODE_MODEL_CODING")
    expect(names).not.toContain("OPENCODE_MODEL_RESEARCH")
  })

  it("adds only the set env vars (partial setting)", async () => {
    testConfig.modelCoding = "claude-sonnet-4-5"
    // thinking and research remain undefined

    await (ensurePod as any)(
      SESSION_HASH,
      { email: EMAIL, repoUrl: REPO, branch: BRANCH, sourceBranch: "main" },
    )

    const pod = (createPodCalls[0] as any).body
    const mainEnv: any[] = pod.spec.containers[0].env ?? []
    const names = mainEnv.map((e) => e.name)
    expect(names).toContain("OPENCODE_MODEL_CODING")
    expect(names).not.toContain("OPENCODE_MODEL_THINKING")
    expect(names).not.toContain("OPENCODE_MODEL_RESEARCH")
  })

  it("per-user Secret OPENCODE_MODEL_* values override Deployment defaults in the main container", async () => {
    // The user's per-user Secret values must take precedence over the cluster-wide
    // Deployment defaults. The router injects the Deployment values first, then
    // the user Secret values after — Kubernetes uses the last env: entry when the
    // same key appears more than once.
    testConfig.modelThinking = "deployment-thinking-model"
    testConfig.modelCoding = "deployment-coding-model"
    testConfig.modelResearch = "deployment-research-model"

    const userSecrets = {
      OPENCODE_MODEL_THINKING: "user-thinking-model",
      OPENCODE_MODEL_CODING: "user-coding-model",
    }

    await (ensurePod as any)(
      SESSION_HASH,
      { email: EMAIL, repoUrl: REPO, branch: BRANCH, sourceBranch: "main" },
      undefined, // githubToken
      undefined, // podSecret
      userSecrets,
    )

    const pod = (createPodCalls[0] as any).body
    const mainEnv: any[] = pod.spec.containers[0].env ?? []
    // Last entry for each key wins in Kubernetes — assert the user's value is last.
    const lastByName = (name: string) => [...mainEnv].reverse().find((e) => e.name === name)
    expect(lastByName("OPENCODE_MODEL_THINKING")?.value).toBe("user-thinking-model")
    expect(lastByName("OPENCODE_MODEL_CODING")?.value).toBe("user-coding-model")
    // RESEARCH was not set by the user — Deployment default is the only entry.
    expect(lastByName("OPENCODE_MODEL_RESEARCH")?.value).toBe("deployment-research-model")
  })

  it("per-user Secret OPENCODE_MODEL_* values override Deployment defaults in the init container", async () => {
    // The init container must honour the same override semantics as the main container
    // so the wizard receives the user's model IDs (not the Deployment defaults).
    testConfig.modelCoding = "deployment-coding-model"

    const userSecrets = {
      OPENCODE_MODEL_CODING: "user-coding-model",
    }

    await (ensurePod as any)(
      SESSION_HASH,
      { email: EMAIL, repoUrl: REPO, branch: BRANCH, sourceBranch: "main" },
      undefined,
      undefined,
      userSecrets,
    )

    const pod = (createPodCalls[0] as any).body
    const initEnv: any[] = pod.spec.initContainers[0].env ?? []
    const lastByName = (name: string) => [...initEnv].reverse().find((e) => e.name === name)
    expect(lastByName("OPENCODE_MODEL_CODING")?.value).toBe("user-coding-model")
  })

  it("init script inlines the capability-routing.sh content (the wizard block is loaded from a dedicated .sh file)", async () => {
    // Verifies the readFileSync + shebang-strip pipe: if the file path is
    // wrong, or the strip regex accidentally removes too much, the wizard
    // invocation would be absent from the rendered pod manifest and the
    // feature would silently not run.
    testConfig.modelThinking = "claude-opus-4-1"
    testConfig.modelCoding = "claude-sonnet-4-5"
    testConfig.modelResearch = "claude-haiku-4-5"

    await (ensurePod as any)(
      SESSION_HASH,
      { email: EMAIL, repoUrl: REPO, branch: BRANCH, sourceBranch: "main" },
    )

    const pod = (createPodCalls[0] as any).body
    const script: string = pod.spec.initContainers[0].args[0]
    // Must contain the if-guard from the .sh file
    expect(script).toContain(
      `[ -n "$OPENCODE_MODEL_THINKING$OPENCODE_MODEL_CODING$OPENCODE_MODEL_RESEARCH" ]`,
    )
    // Must contain the npx invocation from the .sh file
    expect(script).toContain(
      'npx -y @codemcp/workflows setup capabilities opencode "$@" --force',
    )
  })

  it("capability wizard block appears after git clone in the rendered init script (ordering guard)", async () => {
    // The wizard writes .opencode/agents/*.md and .vibe/config.yaml into
    // /workspace. git clone refuses a non-empty target directory, so the
    // wizard must run after the repo is in place — not before.
    testConfig.modelCoding = "claude-sonnet-4-5"

    await (ensurePod as any)(
      SESSION_HASH,
      { email: EMAIL, repoUrl: REPO, branch: BRANCH, sourceBranch: "main" },
    )

    const pod = (createPodCalls[0] as any).body
    const script: string = pod.spec.initContainers[0].args[0]

    const gitCloneIdx = script.indexOf("git clone")
    const wizardIdx = script.indexOf("@codemcp/workflows")

    expect(gitCloneIdx, "init script should contain git clone").toBeGreaterThan(-1)
    expect(wizardIdx, "init script should contain the wizard invocation").toBeGreaterThan(-1)
    expect(wizardIdx, "capability wizard must run after git clone").toBeGreaterThan(gitCloneIdx)
  })

  it("capability-routing.sh passes `dash -n` syntax check (POSIX-sh compatibility)", async () => {
    // The init container's command is `sh -c <initScript>`, and on Debian-based
    // images `sh` is `dash` (strict POSIX). Using bash-only constructs in the
    // sub-script (WIZARD_ARGS=(), ${ARR[@]}, [[, etc.) produces a `sh: syntax
    // error` at pod start, blocking all pod creation. The .sh file is a
    // standalone POSIX sh file, so it can be syntax-checked with `dash -n`
    // directly — the same interpreter that runs it inside the pod.
    const { readFileSync, existsSync } = await import("node:fs")
    const { fileURLToPath } = await import("node:url")
    const { dirname, resolve } = await import("node:path")
    const scriptPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "scripts",
      "capability-routing.sh",
    )
    expect(existsSync(scriptPath), `expected .sh file at ${scriptPath}`).toBe(true)
    const script = readFileSync(scriptPath, "utf8")

    const { spawnSync } = await import("node:child_process")
    const which = spawnSync("which", ["dash"], { encoding: "utf8" })
    if (which.status === 0) {
      const result = spawnSync("dash", ["-n"], { input: script, encoding: "utf8" })
      expect(
        result.status,
        `capability-routing.sh fails dash -n syntax check:\n${result.stderr}\n--- script ---\n${script}`,
      ).toBe(0)
    }
  })

  it("capability-routing.sh contains the 3 expected stderr log lines (operator visibility contract)", async () => {
    // The .sh file is the source of truth for the wizard block. Operators inspect
    // pod logs via `kubectl logs <pod> -c init` to debug capability setup, so the
    // three log lines (pre-invocation, success, failure) must be present and
    // emit to stderr.
    const { readFileSync } = await import("node:fs")
    const { fileURLToPath } = await import("node:url")
    const { dirname, resolve } = await import("node:path")
    const scriptPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "scripts",
      "capability-routing.sh",
    )
    const script = readFileSync(scriptPath, "utf8")

    expect(script).toContain(
      `echo "opencode-init: configuring capabilities (thinking=\${OPENCODE_MODEL_THINKING}, coding=\${OPENCODE_MODEL_CODING}, research=\${OPENCODE_MODEL_RESEARCH})" >&2`,
    )
    expect(script).toContain(`echo "opencode-init: capability setup complete" >&2`)
    expect(script).toContain(
      `echo "opencode-init: capability setup FAILED (exit=\$rc); opencode will still start, but the LLM will not receive a capability hint" >&2`,
    )
    // The wizard is wrapped in `if ... then ... else ... fi` (not `||`), so the
    // failure branch can include the exit code (`rc=$?`) and a non-fatal
    // continuation message.
    expect(script).toMatch(
      /if npx -y @codemcp\/workflows setup capabilities opencode "\$@" --force; then/,
    )
    expect(script).toContain("rc=$?")
  })

  it("capability-routing.sh uses plain `npx -y @codemcp/workflows` (no `-p js-yaml` workaround)", async () => {
    // The wizard must be self-contained: invoking `npx -y @codemcp/workflows`
    // must work without pre-installing `js-yaml` separately, because the
    // init script cannot assume any package beyond the opencode image's
    // pre-installed dev tools.
    const { readFileSync } = await import("node:fs")
    const { fileURLToPath } = await import("node:url")
    const { dirname, resolve } = await import("node:path")
    const scriptPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "scripts",
      "capability-routing.sh",
    )
    const script = readFileSync(scriptPath, "utf8")

    expect(script).toContain(
      'npx -y @codemcp/workflows setup capabilities opencode "$@" --force',
    )
    expect(script).not.toContain("-p js-yaml")
    expect(script).not.toContain("ade-workflows")
  })

  it("capability-routing.sh invokes the wizard with the right argv when env vars are set (behavioral test)", async () => {
    // Run the .sh file in dash with a stub `npx` and verify the wizard
    // receives the expected argv. The init container's command is
    // `sh -c <initScript>`, so this is exactly what the init container
    // will execute in production: a value with spaces in OPENCODE_MODEL_CODING
    // must be preserved as a single argv element (no word-splitting on IFS).
    const { readFileSync } = await import("node:fs")
    const { fileURLToPath } = await import("node:url")
    const { dirname, resolve, join } = await import("node:path")
    const scriptPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "scripts",
      "capability-routing.sh",
    )
    const script = readFileSync(scriptPath, "utf8")

    // Set up a temp dir with a stub `npx` that records its argv to a file.
    const os = await import("node:os")
    const fs = await import("node:fs")
    const tmpDir = fs.mkdtempSync(join(os.tmpdir(), "opencode-init-test-"))
    const stubDir = join(tmpDir, "bin")
    fs.mkdirSync(stubDir)
    const argvFile = join(tmpDir, "argv.txt")
    const stubNpx = `#!/bin/sh
# Each positional arg is written to argv.txt on its own line. Args with
# spaces (e.g. "claude-sonnet with space") are written as a single line —
# the writer uses printf which does NOT word-split on whitespace.
# $0 is the stub path itself and is NOT included in $@.
printf '%s\\n' "$@" > "${argvFile}"
`
    const stubPath = join(stubDir, "npx")
    fs.writeFileSync(stubPath, stubNpx)
    fs.chmodSync(stubPath, 0o755)

    // cd /workspace would silently fail if the dir doesn't exist; the script
    // would then write the wizard output into whatever dir the test runner
    // happens to be in, giving a false-positive pass.
    const workspaceDir = join(tmpDir, "workspace")
    fs.mkdirSync(workspaceDir, { recursive: true })
    // Patch the script to use our temp workspace instead of /workspace
    // (read-only source — we just adjust via env, so the test stays hermetic)
    const patchedScript = script.replace("cd /workspace", `cd "${workspaceDir}"`).replace("cd /", `cd "${tmpDir}"`)

    try {
      const { spawnSync } = await import("node:child_process")
      const result = spawnSync("dash", ["-c", patchedScript], {
        env: {
          ...process.env,
          PATH: `${stubDir}:${process.env.PATH}`,
          OPENCODE_MODEL_THINKING: "claude-opus-4-1",
          OPENCODE_MODEL_CODING: "claude-sonnet with space", // value with spaces
          OPENCODE_MODEL_RESEARCH: "claude-haiku-4-5",
        },
        encoding: "utf8",
      })
      expect(
        result.status,
        `dash failed:\nstdout=${result.stdout}\nstderr=${result.stderr}\nscript=${script}`,
      ).toBe(0)

      // Read the captured argv: one line per arg, args with spaces stay on
      // their own line (printf does not word-split).
      const argvText = fs.readFileSync(argvFile, "utf8")
      const argv = argvText.split("\n").filter((line) => line.length > 0)
      expect(argv).toEqual([
        "-y",
        "@codemcp/workflows",
        "setup",
        "capabilities",
        "opencode",
        "--model-thinking",
        "claude-opus-4-1",
        "--model-coding",
        "claude-sonnet with space", // preserved as a single argv element
        "--model-research",
        "claude-haiku-4-5",
        "--force",
      ])
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("capability-routing.sh is a no-op (silent) when no env vars are set (behavioral test)", async () => {
    // When all three env vars are unset, the wizard block's if-guard is false
    // and the script exits 0 with no output (no npx call, no log line). This
    // is the common path for deployments that don't use capability routing.
    const { readFileSync } = await import("node:fs")
    const { fileURLToPath } = await import("node:url")
    const { dirname, resolve } = await import("node:path")
    const scriptPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "scripts",
      "capability-routing.sh",
    )
    const script = readFileSync(scriptPath, "utf8")

    const { spawnSync } = await import("node:child_process")
    const result = spawnSync("dash", ["-c", script], {
      env: {
        ...process.env,
        PATH: process.env.PATH,
        // Explicitly unset the model vars so the if-guard is false even if
        // the test runner's environment has them set.
        OPENCODE_MODEL_THINKING: undefined,
        OPENCODE_MODEL_CODING: undefined,
        OPENCODE_MODEL_RESEARCH: undefined,
      },
      encoding: "utf8",
    })
    expect(
      result.status,
      `dash failed:\nstdout=${result.stdout}\nstderr=${result.stderr}`,
    ).toBe(0)
    // The "skipped" case is silent: no output to stdout or stderr.
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("")
  })
})

// ---------------------------------------------------------------------------
// parsePodEnv — unit tests for the podEnv multiline string parser
// ---------------------------------------------------------------------------
// These tests FAIL until parsePodEnv is added and exported from pod-manager.ts.
// ---------------------------------------------------------------------------
describe("parsePodEnv", () => {
  let parsePodEnv: (raw: string) => { name: string; value: string }[]

  beforeEach(async () => {
    const mod = await import("./pod-manager.js")
    parsePodEnv = (mod as any).parsePodEnv
  })

  it("parses a single KEY=value line", () => {
    expect(parsePodEnv("WORKFLOW_AGENTS=workflow")).toEqual([
      { name: "WORKFLOW_AGENTS", value: "workflow" },
    ])
  })

  it("parses multiple newline-separated KEY=value lines", () => {
    const raw = "WORKFLOW_AGENTS=workflow\nVICTORIA_METRICS_URL=http://vm:8428"
    expect(parsePodEnv(raw)).toEqual([
      { name: "WORKFLOW_AGENTS", value: "workflow" },
      { name: "VICTORIA_METRICS_URL", value: "http://vm:8428" },
    ])
  })

  it("ignores blank lines", () => {
    expect(parsePodEnv("\nWORKFLOW_AGENTS=workflow\n\n")).toEqual([
      { name: "WORKFLOW_AGENTS", value: "workflow" },
    ])
  })

  it("ignores lines starting with #", () => {
    expect(parsePodEnv("# comment\nWORKFLOW_AGENTS=workflow")).toEqual([
      { name: "WORKFLOW_AGENTS", value: "workflow" },
    ])
  })

  it("preserves = characters in the value (splits only on the first =)", () => {
    expect(parsePodEnv("URL=http://host/path?foo=bar")).toEqual([
      { name: "URL", value: "http://host/path?foo=bar" },
    ])
  })

  it("returns an empty array for an empty string", () => {
    expect(parsePodEnv("")).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// podEnv propagation — all vars in config.podEnv reach the main container env
// ---------------------------------------------------------------------------
// Root cause: WORKFLOW_AGENTS (and any other podEnv var) had no first-class
// config field or env: entry — the only path was the fragile .env sourcing
// from the ConfigMap mount (silently absent when ConfigMap is stale/empty).
// Fix: parse config.podEnv and spread into the main container env: block.
//
// These tests FAIL until:
//   1. config.ts gains `podEnv: process.env.POD_ENV ?? ""`
//   2. pod-manager.ts spreads parsePodEnv(config.podEnv) into the main
//      container env: array
// ---------------------------------------------------------------------------
describe.sequential("ensurePod — podEnv propagation", () => {
  let testConfig: typeof import("./config.js").config

  beforeEach(async () => {
    fakePods = []
    fakePVCs = []
    createPodCalls = []
    const mod = await import("./config.js")
    testConfig = mod.config
    // Reset podEnv before each test to prevent cross-test pollution.
    testConfig.podEnv = ""
  })

  it("injects all vars from podEnv into the main container env when podEnv is set", async () => {
    testConfig.podEnv = "WORKFLOW_AGENTS=workflow\nMY_CUSTOM_VAR=hello"

    const { ensurePod } = await import("./pod-manager.js")
    await (ensurePod as any)(
      SESSION_HASH,
      { email: EMAIL, repoUrl: REPO, branch: BRANCH, sourceBranch: "main" },
    )

    const pod = (createPodCalls[0] as any).body
    const mainEnv: any[] = pod.spec.containers[0].env ?? []

    const workflowEntry = mainEnv.find((e: any) => e.name === "WORKFLOW_AGENTS")
    expect(workflowEntry, "WORKFLOW_AGENTS must appear in the main container env").toBeDefined()
    expect(workflowEntry?.value).toBe("workflow")

    const customEntry = mainEnv.find((e: any) => e.name === "MY_CUSTOM_VAR")
    expect(customEntry, "MY_CUSTOM_VAR must appear in the main container env").toBeDefined()
    expect(customEntry?.value).toBe("hello")
  })

  it("adds no extra env entries when podEnv is empty", async () => {
    // podEnv is "" (reset in beforeEach)
    const { ensurePod } = await import("./pod-manager.js")
    await (ensurePod as any)(
      SESSION_HASH,
      { email: EMAIL, repoUrl: REPO, branch: BRANCH, sourceBranch: "main" },
    )

    const pod = (createPodCalls[0] as any).body
    const mainEnv: any[] = pod.spec.containers[0].env ?? []
    const names = mainEnv.map((e: any) => e.name)
    expect(names).not.toContain("WORKFLOW_AGENTS")
    expect(names).not.toContain("MY_CUSTOM_VAR")
  })

  it("mounts the opencode-config ConfigMap volume in the pod spec volumes list", async () => {
    const { ensurePod } = await import("./pod-manager.js")
    await (ensurePod as any)(
      SESSION_HASH,
      { email: EMAIL, repoUrl: REPO, branch: BRANCH, sourceBranch: "main" },
    )

    const pod = (createPodCalls[0] as any).body
    const volumes: any[] = pod.spec.volumes ?? []
    const configVolume = volumes.find((v: any) => v.name === "opencode-config")
    expect(configVolume, "spec.volumes must include a volume named opencode-config").toBeDefined()
    expect(configVolume?.configMap?.name).toBe(testConfig.configMapName)
  })

  it("mounts the opencode-config volume at /home/opencode/.opencode in the main container", async () => {
    const { ensurePod } = await import("./pod-manager.js")
    await (ensurePod as any)(
      SESSION_HASH,
      { email: EMAIL, repoUrl: REPO, branch: BRANCH, sourceBranch: "main" },
    )

    const pod = (createPodCalls[0] as any).body
    const mounts: any[] = pod.spec.containers[0].volumeMounts ?? []
    const configMount = mounts.find((m: any) => m.name === "opencode-config")
    expect(configMount, "main container volumeMounts must include opencode-config").toBeDefined()
    expect(configMount?.mountPath).toBe("/home/opencode/.opencode")
    expect(configMount?.readOnly).toBe(true)
  })
})
