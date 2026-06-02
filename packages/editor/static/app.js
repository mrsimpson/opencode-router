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

const LANG_MAP = {
  ".ts": "typescript",
  ".js": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".py": "python",
  ".css": "css",
  ".html": "html",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".sh": "shell",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".xml": "xml",
  ".sql": "sql",
  ".dockerfile": "dockerfile",
  ".tf": "hcl",
}

function getExt(name) {
  const i = name.lastIndexOf(".")
  return i >= 0 ? name.slice(i).toLowerCase() : ""
}

function getLanguage(name) {
  const ext = getExt(name)
  return LANG_MAP[ext] || ""
}

function escapeHtml(text) {
  const div = document.createElement("div")
  div.textContent = text
  return div.innerHTML
}

document.addEventListener("DOMContentLoaded", () => {
  const treeRoot = document.getElementById("file-tree")
  const fileLabel = document.getElementById("file-label")
  const saveBtn = document.getElementById("save-btn")
  const saveStatus = document.getElementById("save-status")
  const editorPlaceholder = document.getElementById("editor-placeholder")
  const editorDiv = document.getElementById("editor")

  if (!treeRoot || !fileLabel || !saveBtn || !saveStatus || !editorPlaceholder || !editorDiv) return

  let editor = null
  let currentFilePath = null
  let savedContent = ""
  let isDirty = false

  // Initialize Monaco editor
  require(["vs/editor/editor.main"], () => {
    editor = monaco.editor.create(editorDiv, {
      value: "",
      language: "",
      automaticLayout: true,
      theme: "vs-dark",
      minimap: { enabled: false },
    })

    editor.onDidChangeModelContent(() => {
      if (!currentFilePath) return
      const current = editor.getValue()
      const wasDirty = isDirty
      isDirty = current !== savedContent
      if (isDirty !== wasDirty) {
        updateFileLabel()
      }
    })
  })

  function updateFileLabel() {
    if (!currentFilePath) {
      fileLabel.textContent = "Select a file to edit"
      saveBtn.disabled = true
      return
    }
    const name = currentFilePath.split("/").pop()
    fileLabel.textContent = name + (isDirty ? " *" : "")
    saveBtn.disabled = !isDirty
  }

  function showStatus(message, isError = false) {
    saveStatus.textContent = message
    saveStatus.className = isError ? "error" : ""
    setTimeout(() => {
      if (saveStatus.textContent === message) {
        saveStatus.textContent = ""
        saveStatus.className = ""
      }
    }, 3000)
  }

  async function saveFile() {
    if (!currentFilePath || !editor) return
    const content = editor.getValue()
    try {
      const encodedPath = currentFilePath.replace(/^\//, "").split("/").map(encodeURIComponent).join("/")
      const res = await fetch(`/api/files/${encodedPath}`, {
        method: "PUT",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: content,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }))
        showStatus(`Error: ${err.error}`, true)
        return
      }
      savedContent = content
      isDirty = false
      updateFileLabel()
      showStatus("Saved")
    } catch (e) {
      showStatus("Network error", true)
    }
  }

  saveBtn.addEventListener("click", saveFile)

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault()
      if (isDirty) {
        saveFile()
      }
    }
  })

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
    if (isBinary) return
    if (!editor) {
      showStatus("Editor not ready", true)
      return
    }

    currentFilePath = filePath
    isDirty = false
    savedContent = ""
    updateFileLabel()

    editorPlaceholder.hidden = true
    editorDiv.style.display = "block"

    try {
      const encodedPath = filePath.replace(/^\//, "").split("/").map(encodeURIComponent).join("/")
      const res = await fetch(`/api/files/${encodedPath}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }))
        editor.setValue(err.error === "Binary file" ? "Binary file, cannot preview." : `Error: ${err.error}`)
        savedContent = editor.getValue()
        return
      }
      const text = await res.text()
      const lang = getLanguage(filePath.split("/").pop())

      const model = monaco.editor.createModel(text, lang)
      editor.setModel(model)
      savedContent = text
      isDirty = false
      updateFileLabel()
    } catch (e) {
      editor.setValue("Network error")
      savedContent = editor.getValue()
    }
  }
})
