import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = Number(process.env.EDITOR_PORT ?? 7681)
const STATIC_DIR = path.join(__dirname, "../static")
const HOME_DIR = "/home/opencode"

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
}

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".wav",
  ".ogg",
  ".webm",
  ".mkv",
  ".avi",
  ".mov",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".exe",
  ".so",
  ".dylib",
  ".dll",
  ".bin",
  ".wasm",
  ".pdf",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".o",
  ".a",
  ".obj",
  ".lib",
  ".class",
  ".jar",
  ".pyc",
  ".pyo",
])

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_TYPES[ext] ?? "application/octet-stream"
}

function isPathWithinHome(requestedPath: string): string | null {
  const parts = requestedPath.split(/[\\/]/).filter(Boolean)
  if (parts.includes("..")) {
    return null
  }
  const resolved = path.resolve(HOME_DIR, requestedPath)
  const normalizedHome = path.normalize(HOME_DIR + path.sep)
  const normalizedResolved = path.normalize(resolved + path.sep)
  if (!normalizedResolved.startsWith(normalizedHome)) {
    return null
  }
  return resolved
}

function serveFile(res: http.ServerResponse, filePath: string): void {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain" })
      res.end(err.code === "ENOENT" ? "Not Found" : "Internal Server Error")
      return
    }
    res.writeHead(200, { "Content-Type": getMimeType(filePath) })
    res.end(data)
  })
}

function jsonResponse(res: http.ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(payload))
}

function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
    req.on("error", reject)
  })
}

const server = http.createServer(async (req, res) => {
  const urlPath = req.url ?? "/"

  // Health check
  if (urlPath === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }))
    return
  }

  // API routes
  if (urlPath.startsWith("/api/files")) {
    const parsed = new URL(req.url ?? "/", `http://localhost:${PORT}`)

    // List directory
    if (req.method === "GET" && parsed.pathname === "/api/files") {
      const rawDir = parsed.searchParams.get("dir") ?? ""
      const resolvedDir = isPathWithinHome(rawDir)
      if (!resolvedDir) {
        jsonResponse(res, 400, { error: "Invalid directory path" })
        return
      }

      try {
        const entries = await fs.promises.readdir(resolvedDir, { withFileTypes: true })
        const limited = entries.slice(0, 1000)
        const result = await Promise.all(
          limited.map(async (dirent) => {
            const type = dirent.isDirectory() ? "directory" : "file"
            let size: number | undefined
            if (type === "file") {
              try {
                const stat = await fs.promises.stat(path.join(resolvedDir, dirent.name))
                size = stat.size
              } catch {
                // ignore stat errors
              }
            }
            return { name: dirent.name, type, size }
          })
        )
        jsonResponse(res, 200, result)
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        const status = code === "ENOENT" ? 404 : 500
        jsonResponse(res, status, { error: (err as Error).message })
      }
      return
    }

    // Read file
    if (req.method === "GET" && parsed.pathname.startsWith("/api/files/")) {
      const rawPath = "/" + parsed.pathname.slice("/api/files/".length)
      const resolvedPath = isPathWithinHome(rawPath)
      if (!resolvedPath) {
        jsonResponse(res, 400, { error: "Invalid file path" })
        return
      }

      try {
        const stat = await fs.promises.stat(resolvedPath)
        if (!stat.isFile()) {
          jsonResponse(res, 400, { error: "Not a file" })
          return
        }
        const ext = path.extname(resolvedPath).toLowerCase()
        if (BINARY_EXTENSIONS.has(ext)) {
          jsonResponse(res, 400, { error: "Binary file" })
          return
        }
        const content = await fs.promises.readFile(resolvedPath, "utf-8")
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
        res.end(content)
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        const status = code === "ENOENT" ? 404 : 500
        jsonResponse(res, status, { error: (err as Error).message })
      }
      return
    }

    // Write file
    if (req.method === "PUT" && parsed.pathname.startsWith("/api/files/")) {
      const rawPath = "/" + parsed.pathname.slice("/api/files/".length)
      const resolvedPath = isPathWithinHome(rawPath)
      if (!resolvedPath) {
        jsonResponse(res, 400, { error: "Invalid file path" })
        return
      }

      try {
        const body = await readRequestBody(req)
        const parentDir = path.dirname(resolvedPath)
        await fs.promises.mkdir(parentDir, { recursive: true })
        await fs.promises.writeFile(resolvedPath, body, "utf-8")
        jsonResponse(res, 200, { ok: true })
      } catch (err) {
        jsonResponse(res, 500, { error: (err as Error).message })
      }
      return
    }

    res.writeHead(405, { "Content-Type": "text/plain" }).end("Method Not Allowed")
    return
  }

  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "text/plain" }).end("Method Not Allowed")
    return
  }

  // Static files
  let filePath: string
  if (urlPath === "/" || urlPath === "/index.html") {
    filePath = path.join(STATIC_DIR, "index.html")
  } else {
    const requested = path.normalize(urlPath).replace(/^(\.\.(\/|\\))+/, "")
    filePath = path.join(STATIC_DIR, requested)
    if (!filePath.startsWith(STATIC_DIR)) {
      res.writeHead(403, { "Content-Type": "text/plain" }).end("Forbidden")
      return
    }
  }

  serveFile(res, filePath)
})

server.listen(PORT, () => {
  console.log(`Editor sidecar listening on :${PORT}`)
})
