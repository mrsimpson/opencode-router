import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = Number(process.env.EDITOR_PORT ?? 7681)
const STATIC_DIR = path.join(__dirname, "../static")

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

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_TYPES[ext] ?? "application/octet-stream"
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

const server = http.createServer((req, res) => {
  const urlPath = req.url ?? "/"

  // Only support GET for Slice 1
  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "text/plain" }).end("Method Not Allowed")
    return
  }

  // Health check
  if (urlPath === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }))
    return
  }

  // Static files
  let filePath: string
  if (urlPath === "/" || urlPath === "/index.html") {
    filePath = path.join(STATIC_DIR, "index.html")
  } else {
    // Prevent path traversal
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
