import fs from "node:fs"
import path from "node:path"
import stream from "node:stream"
import * as k8s from "@kubernetes/client-node"
import { config } from "./config.js"
import { k8sApi, getKubeConfig } from "./pod-manager.js"

function hasCode(err: unknown): err is { code: number } {
  return typeof err === "object" && err !== null && "code" in err && typeof (err as Record<string, unknown>).code === "number"
}
function isNotFound(err: unknown): boolean {
  return hasCode(err) && err.code === 404
}

export async function archiveSession(hash: string, openCodeSessionId: string, podName: string, email: string): Promise<void> {
  const userDir = path.join(config.archiveDir, email)
  fs.mkdirSync(userDir, { recursive: true })
  const archivePath = path.join(userDir, `${hash}.json`)

  const exec = new k8s.Exec(getKubeConfig())
  const fileStream = fs.createWriteStream(archivePath)
  const stderrChunks: Buffer[] = []
  const stderr = new stream.PassThrough()
  stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk))

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      fileStream.destroy()
      reject(new Error(`Archive timed out after ${config.archiveTimeoutMs}ms`))
    }, config.archiveTimeoutMs)

    exec
      .exec(
        config.namespace,
        podName,
        "opencode",
        ["opencode", "export", openCodeSessionId],
        fileStream,
        stderr,
        null,
        false,
        (status: k8s.V1Status) => {
          clearTimeout(timeout)
          fileStream.end()
          if (status.status === "Success") {
            resolve()
          } else {
            const stderrText = Buffer.concat(stderrChunks).toString("utf-8").trim()
            reject(new Error(`Export command failed (${status.reason ?? status.status}): ${stderrText || status.message}`))
          }
        },
      )
      .catch((err) => {
        clearTimeout(timeout)
        fileStream.destroy()
        reject(err)
      })
  })
}

export interface ArchiveInfo {
  hash: string
  createdAt: string
  sizeBytes: number
}

export function listArchives(email: string): ArchiveInfo[] {
  try {
    const userDir = path.join(config.archiveDir, email)
    const entries = fs.readdirSync(userDir, { withFileTypes: true })
    const archives: ArchiveInfo[] = []
    const hashRegex = /^[a-f0-9]{12}\.json$/

    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!hashRegex.test(entry.name)) continue

      const hash = entry.name.slice(0, 12)
      const filePath = path.join(userDir, entry.name)
      const stats = fs.statSync(filePath)

      archives.push({
        hash,
        createdAt: stats.birthtime.toISOString(),
        sizeBytes: stats.size,
      })
    }

    // Sort by createdAt descending (newest first)
    archives.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return archives
  } catch (err) {
    console.error("[archive] Failed to list archives:", err)
    return []
  }
}

export function readArchive(hash: string, email: string): { exists: true; data: string; sizeBytes: number } | { exists: false } {
  if (!/^[a-f0-9]{12}$/.test(hash)) {
    return { exists: false }
  }
  const filePath = path.join(config.archiveDir, email, `${hash}.json`)
  try {
    const data = fs.readFileSync(filePath, "utf-8")
    const stats = fs.statSync(filePath)
    return { exists: true, data, sizeBytes: stats.size }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false }
    }
    console.error(`[archive] Failed to read archive ${hash}:`, err)
    return { exists: false }
  }
}

export async function archiveStoppedSession(hash: string, openCodeSessionId: string, email: string): Promise<void> {
  const { buildExportPodManifest } = await import("./pod-manager.js")
  const tempPodName = `opencode-session-${hash}-export`

  // Create temporary pod
  console.log(`[archive] Creating temporary export pod ${tempPodName} for session ${hash}`)
  const manifest = buildExportPodManifest(hash, { email })
  await k8sApi.createNamespacedPod({ namespace: config.namespace, body: manifest })

  try {
    // Wait for pod to be Running
    const deadline = Date.now() + config.archiveTempPodTimeoutMs
    let podRunning = false
    while (Date.now() < deadline) {
      const pod = await k8sApi.readNamespacedPod({ name: tempPodName, namespace: config.namespace })
      if (pod.status?.phase === "Running") {
        podRunning = true
        break
      }
      if (pod.status?.phase === "Failed") {
        throw new Error(`Temporary export pod ${tempPodName} entered Failed phase`)
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }

    if (!podRunning) {
      throw new Error(`Timeout waiting for temporary export pod ${tempPodName} to reach Running state`)
    }

    // Run export in temporary pod
    console.log(`[archive] Temporary export pod ${tempPodName} is Running, starting export`)
    await archiveSession(hash, openCodeSessionId, tempPodName, email)
    console.log(`[archive] Export success for session ${hash} via temporary pod`)
  } finally {
    // Always clean up temporary pod
    console.log(`[archive] Deleting temporary export pod ${tempPodName}`)
    await k8sApi.deleteNamespacedPod({ name: tempPodName, namespace: config.namespace }).catch((err: any) => {
      if (!isNotFound(err)) console.error(`[archive] Failed to delete temporary pod ${tempPodName}:`, err)
    })
  }
}
