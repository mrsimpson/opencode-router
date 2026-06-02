const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".mkv", ".avi", ".mov",
  ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
  ".exe", ".so", ".dylib", ".dll", ".bin",
  ".wasm", ".pdf", ".db", ".sqlite", ".sqlite3",
  ".o", ".a", ".obj", ".lib", ".class", ".jar",
  ".pyc", ".pyo",
])

function getExt(name) {
  const i = name.lastIndexOf(".")
  return i >= 0 ? name.slice(i).toLowerCase() : ""
}

function escapeHtml(text) {
  const div = document.createElement("div")
  div.textContent = text
  return div.innerHTML
}

document.addEventListener("DOMContentLoaded", () => {
  const treeRoot = document.getElementById("file-tree")
  const previewContent = document.getElementById("preview-content")
  const previewPlaceholder = document.getElementById("preview-placeholder")

  if (!treeRoot || !previewContent || !previewPlaceholder) return

  loadDirectory("/home/opencode/repo", treeRoot)

  async function loadDirectory(dirPath, parentUl) {
    try {
      const res = await fetch(`/api/files?dir=${encodeURIComponent(dirPath)}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }))
        parentUl.innerHTML = `<li class="error">${escapeHtml(err.error)}</li>`
        return
      }
      const entries = await res.json()
      renderEntries(entries, dirPath, parentUl)
    } catch (e) {
      parentUl.innerHTML = `<li class="error">Network error</li>`
    }
  }

  function renderEntries(entries, parentPath, parentUl) {
    entries.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name)
      return a.type === "directory" ? -1 : 1
    })

    for (const entry of entries) {
      const li = document.createElement("li")
      const fullPath = parentPath + "/" + entry.name
      const isBinary = entry.type === "file" && BINARY_EXTENSIONS.has(getExt(entry.name))

      const span = document.createElement("span")
      span.className = "entry " + entry.type + (isBinary ? " binary" : "")
      span.textContent = entry.name

      if (entry.type === "directory") {
        span.addEventListener("click", () => toggleDirectory(span, fullPath))
      } else {
        span.addEventListener("click", () => openFile(fullPath, isBinary))
      }

      li.appendChild(span)
      parentUl.appendChild(li)
    }
  }

  function toggleDirectory(span, dirPath) {
    span.classList.toggle("expanded")
    let childUl = span.parentElement.querySelector("ul")
    if (!childUl) {
      childUl = document.createElement("ul")
      childUl.hidden = true
      span.parentElement.appendChild(childUl)
    }

    if (span.classList.contains("expanded")) {
      if (!childUl.dataset.loaded) {
        childUl.dataset.loaded = "true"
        loadDirectory(dirPath, childUl)
      }
      childUl.hidden = false
    } else {
      childUl.hidden = true
    }
  }

  async function openFile(filePath, isBinary) {
    previewPlaceholder.hidden = true
    previewContent.hidden = false
    previewContent.textContent = "Loading..."

    if (isBinary) {
      previewContent.textContent = "Binary file, cannot preview."
      return
    }

    try {
      const encodedPath = filePath.replace(/^\//, "").split("/").map(encodeURIComponent).join("/")
      const res = await fetch(`/api/files/${encodedPath}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }))
        previewContent.textContent =
          err.error === "Binary file" ? "Binary file, cannot preview." : `Error: ${err.error}`
        return
      }
      const text = await res.text()
      previewContent.textContent = text
    } catch (e) {
      previewContent.textContent = "Network error"
    }
  }
})
