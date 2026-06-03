/**
 * In-memory fake Kubernetes client for UI development without a live k8s cluster.
 *
 * Activated by setting MOCK_K8S=true in the environment.
 * Loaded by index.ts before any other imports when MOCK_K8S is set.
 *
 * Pre-seeds three sessions:
 *   - abc123def456  running
 *   - deadbeef1234  stopped (no pod)
 *   - cafe00112233  creating → transitions to running after 5 s
 */

import crypto from "node:crypto"
import path from "node:path"

// Set required env vars before config.ts is evaluated (uses required() which throws if absent)
process.env.OPENCODE_IMAGE ??= "ghcr.io/mrsimpson/opencode:latest"
process.env.ROUTER_DOMAIN ??= "localhost:3002"
process.env.ROUTER_PROTO ??= "http"
process.env.OPENCODE_PORT ??= "4096"

const {
  _setApiClient,
  _setFetch,
  _setActivityFetch,
  _setBootstrapFetch,
  _setHumanId,
} = await import("./pod-manager.js")

// ---------------------------------------------------------------------------
// Constants mirrored from pod-manager.ts
// ---------------------------------------------------------------------------
const LABEL_SESSION_HASH = "opencode.ai/session-hash"
const LABEL_MANAGED_BY = "app.kubernetes.io/managed-by"
const MANAGED_BY_VALUE = "opencode-router"
const ANNOTATION_LAST_ACTIVITY = "opencode.ai/last-activity"
const ANNOTATION_USER_EMAIL = "opencode.ai/user-email"
const ANNOTATION_REPO_URL = "opencode.ai/repo-url"
const ANNOTATION_BRANCH = "opencode.ai/branch"
const ANNOTATION_SOURCE_BRANCH = "opencode.ai/source-branch"
const ANNOTATION_CREATED_AT = "opencode.ai/created-at"
const ANNOTATION_ATTACH_PASSWORD = "opencode.ai/attach-password"
const NAMESPACE = "opencode"

function pvcName(hash: string) {
  return `opencode-pvc-${hash}`
}
function podName(hash: string) {
  return `opencode-session-${hash}`
}

// ---------------------------------------------------------------------------
// Minimal local types for in-memory store items
// ---------------------------------------------------------------------------
type KMeta = { name: string; namespace: string; labels: Record<string, string>; annotations: Record<string, string>; creationTimestamp?: string }
type FakePVC = { metadata: KMeta; spec: object; status: { phase: string } }
type FakePod = { metadata: Omit<KMeta, "creationTimestamp">; status: { phase: string; podIP?: string; conditions?: { type: string; status: string }[]; containerStatuses?: { name: string; ready: boolean }[] } }
type FakeSecret = { metadata: { name: string; namespace: string }; stringData: Record<string, string> }

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------
const fakePVCs: FakePVC[] = []
const fakePods: FakePod[] = []
const fakeSecrets: FakeSecret[] = []

function makePVC(hash: string, email: string, repoUrl: string, branch: string, createdAt: string): FakePVC {
  return {
    metadata: {
      name: pvcName(hash),
      namespace: NAMESPACE,
      creationTimestamp: createdAt,
      labels: {
        [LABEL_SESSION_HASH]: hash,
        [LABEL_MANAGED_BY]: MANAGED_BY_VALUE,
      },
      annotations: {
        [ANNOTATION_USER_EMAIL]: email,
        [ANNOTATION_REPO_URL]: repoUrl,
        [ANNOTATION_BRANCH]: branch,
        [ANNOTATION_SOURCE_BRANCH]: "main",
        [ANNOTATION_LAST_ACTIVITY]: createdAt,
        [ANNOTATION_CREATED_AT]: createdAt,
        [ANNOTATION_ATTACH_PASSWORD]: crypto.randomBytes(12).toString("hex"),
      },
    },
    spec: {},
    status: { phase: "Bound" },
  }
}

function makeRunningPod(hash: string, email: string, repoUrl: string, branch: string, lastActivity: string): FakePod {
  return {
    metadata: {
      name: podName(hash),
      namespace: NAMESPACE,
      labels: {
        [LABEL_SESSION_HASH]: hash,
        [LABEL_MANAGED_BY]: MANAGED_BY_VALUE,
      },
      annotations: {
        [ANNOTATION_LAST_ACTIVITY]: lastActivity,
        [ANNOTATION_USER_EMAIL]: email,
        [ANNOTATION_REPO_URL]: repoUrl,
        [ANNOTATION_BRANCH]: branch,
      },
    },
    status: {
      phase: "Running",
      podIP: "127.0.0.1",
      conditions: [{ type: "Ready", status: "True" }],
      containerStatuses: [
        { name: "opencode", ready: true },
        { name: "chromium", ready: true },
        { name: "editor", ready: true },
      ],
    },
  }
}

function makeCreatingPod(hash: string, email: string, repoUrl: string, branch: string): FakePod {
  return {
    metadata: {
      name: podName(hash),
      namespace: NAMESPACE,
      labels: {
        [LABEL_SESSION_HASH]: hash,
        [LABEL_MANAGED_BY]: MANAGED_BY_VALUE,
      },
      annotations: {
        [ANNOTATION_USER_EMAIL]: email,
        [ANNOTATION_REPO_URL]: repoUrl,
        [ANNOTATION_BRANCH]: branch,
      },
    },
    status: { phase: "Pending" },
  }
}

// ---------------------------------------------------------------------------
// Pre-seed sessions
// ---------------------------------------------------------------------------
const DEV_EMAIL = process.env.DEV_EMAIL ?? "dev@local.test"
const NOW = new Date().toISOString()
const ONE_HOUR_AGO = new Date(Date.now() - 3_600_000).toISOString()

// Session 1: running
const HASH_RUNNING = "abc123def456"
fakePVCs.push(makePVC(HASH_RUNNING, DEV_EMAIL, "https://github.com/example/running-repo", "feat/my-feature", ONE_HOUR_AGO))
fakePods.push(makeRunningPod(HASH_RUNNING, DEV_EMAIL, "https://github.com/example/running-repo", "feat/my-feature", NOW))

// Session 2: stopped (PVC only, no pod)
const HASH_STOPPED = "deadbeef1234"
fakePVCs.push(makePVC(HASH_STOPPED, DEV_EMAIL, "https://github.com/example/stopped-repo", "main", ONE_HOUR_AGO))

// Session 3: creating → transitions to running after 5 s
const HASH_CREATING = "cafe00112233"
fakePVCs.push(makePVC(HASH_CREATING, DEV_EMAIL, "https://github.com/example/creating-repo", "fix/bug-42", NOW))
const creatingPod = makeCreatingPod(HASH_CREATING, DEV_EMAIL, "https://github.com/example/creating-repo", "fix/bug-42")
fakePods.push(creatingPod)

setTimeout(() => {
  const idx = fakePods.findIndex((p) => p.metadata.name === podName(HASH_CREATING))
  if (idx !== -1) {
    fakePods[idx].status = {
      phase: "Running",
      podIP: "127.0.0.2",
      conditions: [{ type: "Ready", status: "True" }],
    }
    console.log(`[mock-k8s] Session ${HASH_CREATING} transitioned to running`)
  }
}, 5_000)

// ---------------------------------------------------------------------------
// Fake k8s client — same shape as fakeK8sApi in pod-manager.test.ts
// ---------------------------------------------------------------------------
const fakeK8sApi = {
  listNamespacedPersistentVolumeClaim: async (_opts: object) => ({ items: fakePVCs }),
  listNamespacedPod: async (_opts: object) => ({ items: fakePods }),
  readNamespacedPod: async ({ name }: { name: string }) => {
    const pod = fakePods.find((p) => p.metadata.name === name)
    if (!pod) {
      const err = Object.assign(new Error("not found"), { code: 404 })
      throw err
    }
    return pod
  },
  readNamespacedPersistentVolumeClaim: async ({ name }: { name: string }) => {
    const pvc = fakePVCs.find((p) => p.metadata.name === name)
    if (!pvc) {
      const err = Object.assign(new Error("not found"), { code: 404 })
      throw err
    }
    return pvc
  },
  createNamespacedPod: async ({ body }: { namespace: string; body: FakePod }) => {
    fakePods.push(body)
    // If this is an export pod, immediately transition to Running
    if (body.metadata?.name?.endsWith("-export")) {
      setTimeout(() => {
        const pod = fakePods.find((p) => p.metadata.name === body.metadata.name)
        if (pod) {
          pod.status = {
            phase: "Running",
            podIP: "127.0.0.1",
            conditions: [{ type: "Ready", status: "True" }],
          }
          console.log(`[mock-k8s] Export pod ${body.metadata.name} transitioned to Running`)
        }
      }, 100)
    }
    return body
  },
  createNamespacedPersistentVolumeClaim: async ({ body }: { namespace: string; body: FakePVC }) => {
    fakePVCs.push(body)
    return body
  },
  patchNamespacedPod: async ({ name, body }: { name: string; body: { metadata?: { annotations?: Record<string, string> } } }) => {
    const pod = fakePods.find((p) => p.metadata.name === name)
    if (pod && body.metadata?.annotations) {
      pod.metadata.annotations = { ...pod.metadata.annotations, ...body.metadata.annotations }
    }
  },
  deleteNamespacedPod: async ({ name }: { name: string }) => {
    const idx = fakePods.findIndex((p) => p.metadata.name === name)
    if (idx === -1) throw Object.assign(new Error("not found"), { code: 404 })
    fakePods.splice(idx, 1)
  },
  patchNamespacedPersistentVolumeClaim: async ({ name, body }: { name: string; body: { metadata?: { annotations?: Record<string, string> } } }) => {
    const pvc = fakePVCs.find((p) => p.metadata.name === name)
    if (pvc && body.metadata?.annotations) {
      pvc.metadata.annotations = { ...pvc.metadata.annotations, ...body.metadata.annotations }
    }
  },
  deleteNamespacedPersistentVolumeClaim: async ({ name }: { name: string }) => {
    const idx = fakePVCs.findIndex((p) => p.metadata.name === name)
    if (idx === -1) throw Object.assign(new Error("not found"), { code: 404 })
    fakePVCs.splice(idx, 1)
  },
  createNamespacedSecret: async ({ body }: { namespace: string; body: FakeSecret }) => {
    if (fakeSecrets.some((s) => s.metadata.name === body.metadata.name)) {
      throw Object.assign(new Error("Conflict"), { code: 409 })
    }
    fakeSecrets.push(body)
    return body
  },
  replaceNamespacedSecret: async ({ name, body }: { name: string; namespace: string; body: FakeSecret }) => {
    const s = fakeSecrets.find((s) => s.metadata.name === name)
    if (s) Object.assign(s.stringData, body.stringData ?? {})
  },
  deleteNamespacedSecret: async ({ name }: { name: string }) => {
    const idx = fakeSecrets.findIndex((s) => s.metadata.name === name)
    if (idx === -1) throw Object.assign(new Error("not found"), { code: 404 })
    fakeSecrets.splice(idx, 1)
  },
  readNamespacedSecret: async ({ name }: { name: string }) => {
    const s = fakeSecrets.find((s) => s.metadata.name === name)
    if (!s) throw Object.assign(new Error("not found"), { code: 404 })
    return s
  },
  connectGetNamespacedPodExec: async ({ name, command }: { name: string; command: string[] }) => {
    const hash = name.replace("opencode-session-", "")
    const { config } = await import("./config.js")
    const archiveDir = config.archiveDir
    const openCodeSessionId = command?.[2] ?? "mock-session"
    const mockJson = JSON.stringify({ openCodeSessionId, exported: true, mock: true, timestamp: new Date().toISOString() })
    const payload = Buffer.concat([Buffer.from([1]), Buffer.from(mockJson)])

    const fs = await import("node:fs")
    fs.mkdirSync(archiveDir, { recursive: true })

    // Property-based injection for test/dev modes (prefer over env vars)
    if (fakeK8sApi._execShouldFail) {
      const mockWs = {
        on(event: string, cb: Function) {
          if (event === "open") setTimeout(() => cb(), 0)
          if (event === "error") setTimeout(() => cb(new Error("MOCK_ARCHIVE_FAIL enabled")), 0)
        },
        close() {},
      }
      return { socket: mockWs, ws: mockWs }
    }

    if (fakeK8sApi._execShouldHang) {
      const mockWs = {
        on(event: string, cb: Function) {
          if (event === "open") setTimeout(() => cb(), 0)
          // Never emit message or close → simulates a hang
        },
        close() {},
      }
      return { socket: mockWs, ws: mockWs }
    }

    // Default success path
    const mockWs = {
      on(event: string, cb: Function) {
        if (event === "open") setTimeout(() => cb(), 0)
        if (event === "message") setTimeout(() => cb(payload), 0)
        if (event === "close") setTimeout(() => cb(), 10)
      },
      close() {},
    }

    return { socket: mockWs, ws: mockWs }
  },
  _execShouldFail: false,
  _execShouldHang: false,
}

// ---------------------------------------------------------------------------
// Inject fakes into pod-manager
// ---------------------------------------------------------------------------

// Replace k8s client
_setApiClient(fakeK8sApi as any)

// remoteBranchExists — always true so startSession doesn't fail
_setFetch(async () => new Response("true", { status: 200 }))

// Activity fetch — return empty sessions array (podActivityMs expects { id, time: { updated } }[])
// An empty array means "pod reachable but no sessions yet" → triggers bootstrapPodSession for
// the pre-seeded running session so the UI shows a deep-link URL after the bootstrap mock runs.
_setActivityFetch(async () => new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }))

// Bootstrap fetch — return a fake session ID
_setBootstrapFetch(async () => new Response(JSON.stringify({ id: "mock-session-00000001" }), { status: 200, headers: { "Content-Type": "application/json" } }))

// Deterministic branch names in mock mode
let _humanIdCounter = 0
_setHumanId(() => `mock-branch-${++_humanIdCounter}`)

console.log(`[mock-k8s] Mock k8s active — pre-seeded ${fakePVCs.length} sessions (running: ${HASH_RUNNING}, stopped: ${HASH_STOPPED}, creating: ${HASH_CREATING})`)
