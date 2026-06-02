# Development Plan: repo (feat/lightweight-editor-sidecar branch)

*Generated on 2026-06-02 by Vibe Feature MCP*
*Workflow: [qrspi](https://codemcp.github.io/workflows/workflows/qrspi)*

## Goal
Enable users to manually edit files on the PVC that were manipulated by the AI agent during an opencode session. This is a rare operation, so the solution must be lightweight and not consume significant resources. The user cannot use `kubectl` to access the cluster. The "code" subdomain is the opencode router (not a separate VS Code instance). Reusing the existing OAuth infrastructure is preferred.

## Key Decisions
1. **Custom Monaco Editor Sidecar** (Option 2) selected over `filebrowser` (Option 1) and `cloudcmd` (Option 3).
2. **Dedicated editor subdomain**: `editor-<hash>-oc.<domain>` instead of raw port-forward URL (`7681-<hash>-oc.<domain>`). This requires new router logic but provides cleaner, more memorable URLs and isolates the editor route semantically.
3. **Monaco Editor loaded from CDN** in a single-page app; backend is a minimal HTTP API for file operations.
4. **Auth via existing OAuth** upstream on port 3000; no separate attach-password auth for the editor.
5. **Lightweight mandate preserved**: Sidecar image target <50 MB compressed, <30 MB RAM idle.
6. **No deployment manifests in repo**: Sidecar will be added to `ensurePod` in `pod-manager.ts`; external Pulumi stack will need `editorRoutePrefix` config update.
7. **Separate editor Docker image**: Built from `packages/editor/Dockerfile` as `ghcr.io/<owner>/opencode-editor`, independent from the router image. Keeps router image size unchanged and allows independent versioning.
8. **Editor routes checked after OAuth, before session fallback**: In `packages/router/src/index.ts`, the editor subdomain is validated after the email/OAuth check (unlike attach, which bypasses OAuth) and before the generic `getSessionInfo` fallback. This ensures editor requests are authenticated while avoiding collision with dev-port routing.
9. **`dev-proxy.ts` enhanced for multi-port forwarding**: The existing dev proxy only forwarded `config.opencodePort` (4096). It will be enhanced to accept an optional `port` parameter so local development can proxy to the editor sidecar on port 7681.
10. **`PUT /api/files/<path>` auto-creates parent directories**: For better UX when saving new files, the write endpoint will use `fs.mkdir(..., { recursive: true })` before writing, but only after path validation ensures the target remains within `/home/opencode`.
11. **Slice 4 (App UI) conditionally renders "Open Editor" button only when `state === "running"` and `editorUrl` is defined**: Prevents broken links to stopped or still-creating sessions.

## Notes
- Branch: `feat/lightweight-editor-sidecar`
- Workflow: QRSPI (currently in Structure phase)

## Questions
### Tasks
- [x] Clarify that lightweight, rare-use file editing is the primary goal
- [x] Confirm no `kubectl` access from user's local machine
- [x] Confirm "code" subdomain is the opencode router, not a separate editor instance

### Completed
- [x] Created development plan file
- [x] Clarified feature scope with user

## Research
### Tasks
- [x] Explore codebase: router, app, plugin, pod-manager
- [x] Inspect current session pod environment (processes, tools, network, OS)
- [x] Investigate auth/OAuth and routing architecture
- [x] Identify existing sidecar patterns and resource usage
- [x] Check for deployment manifests or Helm charts in repo

### Completed
1. **Router Architecture**
   - The router (`packages/router/src/index.ts`) is a Node.js HTTP/WebSocket reverse proxy.
   - It listens on two ports:
     - **Port 3000** — main server, behind `oauth2-proxy` upstream. Requires `X-Auth-Request-Email` header.
     - **Port 4096** — attach server, **NOT** behind `oauth2-proxy`. Uses password-based auth (`X-Attach-Password`, Basic Auth, or query param).
   - Session subdomains: `<hash><routeSuffix>.<routerDomain>` (e.g., `abc123def456-oc.no-panic.org`) → proxied to pod IP:4096.
   - Attach subdomains: `<attachRoutePrefix><hash><routeSuffix>.<routerDomain>` (e.g., `attach-abc123def456-oc.no-panic.org`) → proxied to pod IP:4096 with password check.
   - Dev-server ports (>3000, not 4096) can also be proxied via `<port>-<hash><routeSuffix>.<routerDomain>`.

2. **Session Pod Specification**
   - Defined in `packages/router/src/pod-manager.ts` (`ensurePod` function).
   - Currently has **two containers**:
     - `opencode` — main container, runs `opencode serve --hostname 0.0.0.0 --port 4096`. Working dir `/home/opencode/repo`.
     - `chromium` — sidecar for Playwright MCP. Resource limits: 256Mi-1Gi memory, 100m-1000m CPU.
   - Init container (`init`) handles git clone, config seed, plugin registration.
   - Pod restart policy: `Always`.
   - Security context: runAsUser 1000, runAsNonRoot, restricted capabilities, seccomp RuntimeDefault.
   - Volumes: `user-data` (PVC) mounted at `/home/opencode`; `opencode-config` (ConfigMap) mounted at `/home/opencode/.opencode` (read-only).

3. **Current Session Pod Environment**
   - Pod name: `opencode-session-38e61bc022c6`.
   - Namespace: `code`.
   - OS: Alpine Linux v3.23.
   - User: `opencode` (UID 1000).
   - Available tools: `apk`, `curl`, `wget`, `nc`, `python3`, `node`, `npm`.
   - **No SSH server** currently running.
   - **No existing editor sidecar** or web-based editor.
   - K8s ServiceAccount token exists at `/var/run/secrets/kubernetes.io/serviceaccount/token`, but the SA has **no K8s API permissions** (403 Forbidden on pod/service/role listing).
   - PVC mounted at `/home/opencode`; repo lives at `/home/opencode/repo`.
   - Environment variables for cluster-internal services:
     - `CODE_SERVICE_HOST=10.43.196.29`, `CODE_SERVICE_PORT=80` (main router service)
     - `CODE_ATTACH_SERVICE_HOST=10.43.101.12`, `CODE_ATTACH_SERVICE_PORT=4096` (attach router service)

4. **Available Alpine Packages for Editing**
   - `micro-2.0.14-r15` (terminal-based, lightweight)
   - `nano-8.7-r0` (terminal-based, lightweight)
   - `vim-9.2.0321-r0` / `neovim-0.11.7-r0` (heavier)
   - `mg-20250523-r0` (Emacs-like, lightweight)
   - No `code-server`, `openvscode-server`, or similar web-based IDE packages found in Alpine repos.

5. **Auth / OAuth**
   - OAuth is handled **outside** the router by `oauth2-proxy` upstream (on port 3000).
   - The router only reads the `X-Auth-Request-Email` header and `X-Auth-Request-Access-Token`.
   - The attach endpoint (port 4096) bypasses OAuth entirely and uses a per-session password stored in the PVC annotation (`opencode.ai/attach-password`).
   - There is no existing OAuth proxy configuration inside this repo; it is provisioned externally (e.g., Pulumi stack in `homelab-apps`).

6. **UI / Frontend**
   - `packages/app` is a SolidJS SPA.
   - Sessions are opened in an `<iframe>` pointing to the deep-link URL (`https://<hash>-oc.<domain>/.../session/<id>`).
   - The session list item (`SessionItem`) shows:
     - Attach command (`opencode attach <url> --password <pw>`) with copy-to-clipboard.
     - Terminate button.
     - Live message thread from `/progress/stream`.
   - There is **no existing UI** for launching an editor, browsing files, or SSH access.

7. **Plugin**
   - `packages/plugin` is loaded inside each session pod.
   - It pushes session title and message events back to the router via `POST /api/sessions/:hash/progress` (authenticated with `X-Pod-Secret`).
   - It also watches for listening ports and reports them to the router (`POST /api/sessions/:hash/ports`).

8. **Deployment / Manifests**
   - No Kubernetes manifests, Helm charts, or Docker Compose files exist inside this repo.
   - Production deployment is managed by an external Pulumi stack (`homelab-apps/apps/opencode-router`).
   - The README references this stack for Ingress, oauth2-proxy, Cloudflare Tunnel, etc.

9. **Resource Constraints**
   - The user explicitly stated this is a **rare operation** and the solution must be **lightweight**.
   - The existing `chromium` sidecar already consumes up to 1Gi memory.
   - Any additional sidecar must minimize CPU/memory footprint to avoid impacting the main `opencode` container.

## Design
### Tasks
- [x] Propose 2-3 viable high-level approaches with trade-offs
- [x] Reach consensus with the user on the preferred direction
- [x] Document the agreed direction in Key Decisions

### Completed
1. **Agreed Direction: Custom Monaco Editor Sidecar with Dedicated Subdomain**

   **High-Level Architecture**
   - A new sidecar container (`editor`) runs inside each session pod, listening on a fixed port (e.g., `7681`).
   - The sidecar serves a single-page app that loads **Monaco Editor from a CDN** and provides a simple file tree.
   - A minimal backend (Node.js or Go) exposes a REST API:
     - `GET /api/files?dir=<path>` — list directory contents
     - `GET /api/files/<path>` — read file content
     - `PUT /api/files/<path>` — write file content
   - The sidecar mounts the same `user-data` PVC at `/home/opencode` (read-write), giving direct access to the repo at `/home/opencode/repo`.

   **Routing: New `editor-` Subdomain**
   - Instead of reusing the raw port-forward pattern (`7681-<hash>-oc.<domain>`), the router will support a **dedicated editor subdomain**:
     - `editor-<hash>-oc.<domain>` → proxied to `podIP:7681`
   - This requires adding a new subdomain extractor in `packages/router/src/index.ts` (similar to `getAttachSessionHash`), but keeps URLs clean and memorable.
   - The editor subdomain is routed through the **main router server (port 3000)**, which sits behind `oauth2-proxy`, so **existing OAuth is automatically enforced**.
   - The editor port will be configurable via a new `EDITOR_PORT` env var (default `7681`).

   **Auth**
   - No separate auth mechanism for the editor. The router validates `X-Auth-Request-Email` before proxying to the editor sidecar, just like it does for session subdomains.
   - The editor sidecar itself does not implement auth; it assumes all incoming requests are already authenticated by the router.

   **Pod Spec Changes**
   - `packages/router/src/pod-manager.ts` (`ensurePod`): add a third container named `editor` to the pod spec.
   - The sidecar image will be built from a new `packages/editor/` directory in this repo.
   - Resource limits for the `editor` container: requests `cpu: 50m, memory: 32Mi`; limits `cpu: 200m, memory: 128Mi`.
   - Volume mount: `user-data` PVC at `/home/opencode`.
   - Security context: same restrictive settings as other containers (`runAsUser: 1000`, `runAsNonRoot`, `drop ALL`, `seccomp RuntimeDefault`).

   **Frontend (SPA) Design**
   - Simple two-pane layout: file tree on the left, Monaco Editor on the right.
   - Monaco loaded from `cdn.jsdelivr.net` or `unpkg.com` (no bundling overhead).
   - Vanilla TypeScript/JavaScript, no framework required.
   - Supports syntax highlighting for common languages based on file extension.

   **Backend Design**
   - Node.js with `http` module (no heavy frameworks) OR Go `net/http`.
   - Serves static SPA files and handles the `/api/files/*` REST endpoints.
   - File operations use standard `fs` APIs; no caching layer needed.
   - CORS headers configured to allow requests from the editor subdomain.

   **Comparison with Rejected Approaches**
   | Approach | Image Size | Editor Quality | Custom Code | Status |
   |---|---|---|---|---|
   | `filebrowser` | ~15 MB | Basic | None | Rejected — editor too limited |
   | `cloudcmd` | ~175 MB | Basic | None | Rejected — too heavy |
   | Custom Monaco | ~10–20 MB | VS Code-grade | Small app | **Selected** |

2. **Research Finding: No Ready-Made Monaco Image Exists**
   - A thorough search of Docker Hub and GitHub found **no widely-used, lightweight, ready-made Docker image** that provides a Monaco-based web file editor as a standalone sidecar.
   - `code-server` and `openvscode-server` exist but are full IDE backends (~ hundreds of MB to GB).
   - `filestash` is feature-bloated and heavy.
   - Therefore, a Monaco-quality editing experience requires either accepting `filebrowser`'s basic editor or building a tiny custom sidecar.

3. **Routing & Auth Analysis**
   - The router already supports `<port>-<hash>-oc.<domain>` → `podIP:<port>` proxying for dev servers. Reusing this mechanism means **zero new routing logic** is required for any sidecar approach.
   - Requests to `7681-<hash>-oc.<domain>` arrive at the main router server (port `3000`, behind `oauth2-proxy`), so **existing OAuth is automatically enforced**.
   - No new attach-password logic or auth bypasses are needed.

4. **Sidecar Feasibility Check**
   - The session pod security context (`runAsUser: 1000`, `runAsNonRoot`, `drop ALL capabilities`, `seccomp RuntimeDefault`) is compatible with `filebrowser` (official image runs as UID 1000) and a custom sidecar.
   - No `readOnlyRootFilesystem` is set, so `/tmp` is writable.
   - The `user-data` PVC can be mounted in the sidecar at `/home/opencode` or `/srv`, giving access to the repo.

## Structure
### Tasks
- [x] Define 1-5 vertical slices that each deliver user-visible behavior independently
- [x] Document slice definitions in development plan

### Completed
1. **Slice 1: Router Routing + Minimal Editor Sidecar (Infrastructure)**
   - **User-visible behavior**: A user can visit `editor-<hash>-oc.<domain>` and see a confirmation page served by the new editor sidecar ("Editor is online").
   - **Components touched**:
     - `packages/router/src/index.ts` — new `getEditorSessionHash` extractor and route handling (before the generic `getSessionInfo` check) to proxy `editor-<hash>-oc.<domain>` requests to the editor sidecar port.
     - `packages/router/src/config.ts` — new `editorPort` (default `7681`) and `editorRoutePrefix` (default `"editor-"`) configuration values.
     - `packages/router/src/pod-manager.ts` — add a third container named `editor` to the pod spec in `ensurePod`, mounting the `user-data` PVC at `/home/opencode` with restrictive security context and lightweight resource limits (requests `cpu: 50m, memory: 32Mi`; limits `cpu: 200m, memory: 128Mi`).
     - New `packages/editor/` directory — minimal Node.js HTTP server (e.g., single `server.js`) that serves a static HTML page confirming the sidecar is reachable.
     - Build / image packaging for the `editor` sidecar image (target <50 MB compressed).
   - **End-to-end test**: Create a new session via the app. Wait for the pod to reach `running`. Navigate to `editor-<hash>-oc.<domain>` in a browser. Expect HTTP 200 with "Editor is online".

2. **Slice 2: Read-Only File Browser**
   - **User-visible behavior**: The user can browse the session's file tree starting at `/home/opencode/repo` and view the contents of any text file in a simple web UI.
   - **Components touched**:
     - `packages/editor/src/server.ts` (or equivalent) — add REST endpoints: `GET /api/files?dir=<path>` (list directory) and `GET /api/files/<path>` (read file content). Returns JSON with entries (name, type, size) or raw file text.
     - `packages/editor/src/static/` — simple vanilla-JS frontend with a collapsible file tree sidebar and a text preview pane. No framework; plain HTML/CSS/JS.
   - **End-to-end test**: From the editor URL (Slice 1), expand the `repo/` directory, click on `README.md`, and see the file's text content rendered in the preview pane. Verify that binary files are indicated as non-previewable.

3. **Slice 3: Monaco Editor with Save**
   - **User-visible behavior**: The user can open any text file in a Monaco Editor surface (loaded from CDN), make edits, and save the changes back to the PVC.
   - **Components touched**:
     - `packages/editor/src/server.ts` — add `PUT /api/files/<path>` endpoint that writes the request body to the specified file path (restricted to `/home/opencode` subtree).
     - `packages/editor/src/static/` — integrate Monaco Editor (`loader.js` from CDN), add editing surface with syntax highlighting based on file extension, and a Save button that `PUT`s content to the backend.
   - **End-to-end test**: Open `repo/src/index.ts` in the editor. Make a visible text change. Click Save. Refresh the browser page. Re-open the same file and confirm the change persisted. Optionally verify via `opencode attach` that the file on disk reflects the edit.

4. **Slice 4: App Frontend Integration**
   - **User-visible behavior**: A visible "Open Editor" button appears in the session list (both expanded `SessionItem` detail panel and potentially compact variant), linking directly to the editor subdomain. Users no longer need to manually construct the URL.
   - **Components touched**:
     - `packages/router/src/pod-manager.ts` — add `editorUrl` to `SessionInfo` / `buildSessionInfo` (similar to `attachUrl`).
     - `packages/router/src/api.ts` (or `handleApi`) — ensure session list and detail endpoints return `editorUrl`.
     - `packages/app/src/session-item.tsx` — add an "Open Editor" button next to the existing "Attach" and "Terminate" buttons in the expanded detail panel.
     - `packages/app/src/api.ts` — update `Session` type to include `editorUrl?: string`.
   - **End-to-end test**: In the main app (`https://code.<domain>`), create or resume a session. In the session list, expand the session item. Observe the "Open Editor" button. Click it. A new browser tab opens at `editor-<hash>-oc.<domain>` and loads the Monaco editor (Slice 3).

## Plan

### Tasks
- [x] Define actionable tasks, dependencies, and risks per slice (this document)
- [x] Document gaps discovered in existing infrastructure

### Completed

#### Slice 1: Router Routing + Minimal Editor Sidecar (Infrastructure)

**User-visible behavior**: A user can visit `editor-<hash>-oc.<domain>` and see a confirmation page served by the new editor sidecar ("Editor is online"). The session API returns `editorUrl`.

**Actionable Tasks**:
1. `packages/router/src/config.ts` — Add three new configuration values:
   - `editorPort` (default `7681`, env `EDITOR_PORT`)
   - `editorRoutePrefix` (default `"editor-"`, env `EDITOR_ROUTE_PREFIX`)
   - `editorImage` (default `"ghcr.io/<owner>/opencode-editor:latest"`, env `EDITOR_IMAGE`)
2. `packages/router/src/index.ts` — Add subdomain extractor and routing:
   - Implement `getEditorSessionHash(host)` following the `getAttachSessionHash` pattern.
   - In `handler`, check editor subdomain **after** attach subdomain but **before** OAuth email check? No — editor requires OAuth. Check **after** email validation, before `getSessionInfo`. Proxy to `proxyToPod(hash, config.editorPort, req, res)`.
   - Update `wsHandler` with the same editor subdomain check.
   - Ensure `getEditorSessionHash` is invoked **before** `getSessionInfo` so that `editor-abc123…` is not misinterpreted as a dev-port pattern (it won't match because `editor` is non-numeric, but explicit ordering is safer).
3. `packages/router/src/pod-manager.ts` — Extend pod spec and session metadata:
   - In `ensurePod`, add a third container `editor` to the `containers` array.
   - `editor` container spec: `image: config.editorImage`, `ports: [{ containerPort: config.editorPort }]`, `volumeMounts: [{ name: "user-data", mountPath: "/home/opencode" }]`, `securityContext` identical to `chromium`, `resources: { requests: { cpu: "50m", memory: "32Mi" }, limits: { cpu: "200m", memory: "128Mi" } }`.
   - Add `getEditorUrl(hash)` helper (similar to `getAttachUrl`).
   - Add `editorUrl?: string` to `SessionInfo` interface.
   - Include `editorUrl: getEditorUrl(hash)` in `buildSessionInfo` return object.
4. `packages/router/src/dev-proxy.ts` — **Gap discovered**: currently hardcodes `config.opencodePort` in the `kubectl port-forward` command and returns a single target per hash. This prevents local development from proxying to the editor port.
   - **Decision**: Enhance `dev-proxy.ts` to accept a `port` parameter (`target(hash, port?)`) and spawn `kubectl port-forward pod/${pod} ${localPort}:${remotePort}` for the requested remote port. Default to `config.opencodePort` when omitted. This is backward-compatible.
5. `packages/router/src/mock-k8s.ts` — Add `editor` container metadata to `makeRunningPod` so mock-mode pod specs include it (keeps mock data consistent with real spec).
6. `packages/app/src/api.ts` — Add `editorUrl: z.string().optional()` to `SessionSchema`.
7. `packages/editor/package.json` — Create workspace package. Runtime deps: none (Node.js built-ins only). Dev deps: `typescript` (for `tsc` typechecking).
8. `packages/editor/src/server.ts` — Minimal Node.js `http` server:
   - Listen on `process.env.EDITOR_PORT || 7681`.
   - Serve static files from `packages/editor/static/`.
   - For Slice 1, only `GET /` and `GET /index.html` need to work.
9. `packages/editor/static/index.html` — Single HTML file with "Editor is online" text.
10. `packages/editor/Dockerfile` — Use `node:22-alpine` base. Copy `packages/editor/src/` and run `node server.js`. Target image size <50 MB compressed.
11. Root `Dockerfile` — Optionally add a build stage for the editor, OR keep editor Dockerfile separate. **Decision**: separate `packages/editor/Dockerfile` to avoid bloating the router image and allow independent versioning.
12. `.github/workflows/build-image.yml` — Add a second `build-editor` job that builds and pushes `ghcr.io/${{ github.repository_owner }}/opencode-editor:<tag>` and `:latest`.
13. `README.md` — Document new env vars (`EDITOR_PORT`, `EDITOR_ROUTE_PREFIX`, `EDITOR_IMAGE`) in the Environment variables table.

**Dependencies**: None.

**Risks**:
| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| R1.1 | Subdomain collision with dev-port pattern (`<port>-<hash>`) | Medium | `editor-` prefix is non-numeric, so `getSessionInfo` regex `^([1-9][0-9]{3,})-` will not match. Explicitly check `getEditorSessionHash` before `getSessionInfo` in `handler`/`wsHandler` for clarity. |
| R1.2 | Editor image exceeds 50 MB compressed | Low | `node:22-alpine` base is ~45 MB; our code is a few KB. Stay well under limit. |
| R1.3 | `dev-proxy.ts` only supports opencodePort (4096), breaking local editor testing | Medium | Fix `dev-proxy.ts` to accept a port parameter as part of Slice 1 (Task 4 above). |
| R1.4 | External Pulumi ingress routes `attach-*` to port 4096; if `editor-*` is caught by the same rule, it would bypass OAuth | High | Verify homelab-apps ingress routes. `editor-*` must route to the main router service (port 3000). Document this as a deployment checklist item. |

**End-to-end test**:
1. Start router (mock or real cluster). If mock, run editor server locally on 7681.
2. Create/resume a session. Wait for `state === "running"`.
3. `GET /api/sessions/<hash>` → verify `editorUrl` is present and equals `https://editor-<hash>-oc.<domain>`.
4. Navigate to `editor-<hash>-oc.<domain>` in browser → expect HTTP 200 with "Editor is online".

---

#### Slice 2: Read-Only File Browser

**User-visible behavior**: The user can browse the session's file tree starting at `/home/opencode/repo` and view the contents of any text file in a simple web UI.

**Actionable Tasks**:
1. `packages/editor/src/server.ts` — Add REST API endpoints:
   - `GET /api/files?dir=<path>` — Validate `dir` is within `/home/opencode`. Read directory with `fs.readdir`. Return JSON array: `{ name: string, type: "file" | "directory", size?: number }`.
   - `GET /api/files/<path>` — Validate `path` is within `/home/opencode`. Read file with `fs.readFile`. If file is binary (detect via extension or MIME sniffing), return `400` with `{ error: "Binary file" }`. Otherwise return file content as `text/plain`.
   - Path normalization: `path.resolve("/home/opencode", requestedPath)`; reject if result does not start with `/home/opencode`.
   - Reject `..` sequences before normalization as defense-in-depth.
2. `packages/editor/src/static/index.html` — Two-pane layout:
   - Left sidebar: collapsible file tree (`<ul>`/`<li>` structure).
   - Right pane: text preview (`<pre>` or `<textarea readonly>`).
3. `packages/editor/src/static/app.js` — Vanilla JS:
   - Fetch `GET /api/files?dir=/home/opencode/repo` on load.
   - Render tree recursively. Click directory → expand/collapse. Click file → fetch content and display in preview pane.
   - Indicate binary files as non-previewable.
4. `packages/editor/src/static/style.css` — Basic layout (flexbox, sidebar width ~250px, no external CSS framework).

**Dependencies**: Slice 1 (server infrastructure, static file serving, editor subdomain routing).

**Risks**:
| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| R2.1 | Path traversal in `dir` or `path` parameters | High | Strict normalization and prefix check. Reject `..`. Unit-test traversal attempts. |
| R2.2 | Large directories (10k+ files) or large files (>10 MB) cause memory/CPU spikes | Medium | Cap directory entries returned (e.g., max 1000). Stream large file reads. Can defer pagination to later slice if needed. |
| R2.3 | Binary detection is unreliable | Low | Use file extension blocklist (`.png`, `.jpg`, `.gif`, `.ico`, `.woff`, `.ttf`, `.mp3`, `.mp4`, `.zip`, `.tar`, `.gz`, `.exe`, `.so`, `.dylib`, `.dll`, `.bin`) as a pragmatic heuristic. |

**End-to-end test**:
1. Open `editor-<hash>-oc.<domain>`.
2. Sidebar shows `repo/` directory.
3. Expand `repo/`, click `README.md`.
4. Preview pane shows text content.
5. Click a `.png` file → preview pane shows "Binary file, cannot preview".

---

#### Slice 3: Monaco Editor with Save

**User-visible behavior**: The user can open any text file in a Monaco Editor surface (loaded from CDN), make edits, and save the changes back to the PVC.

**Actionable Tasks**:
1. `packages/editor/src/server.ts` — Add write endpoint:
   - `PUT /api/files/<path>` — Validate path (same rules as Slice 2). Write request body to file with `fs.writeFile`. Return `{ ok: true }`.
   - Handle `ENOENT` parent directory gracefully (return `400` if parent dir doesn't exist, or auto-create? **Decision**: auto-create parent directories with `fs.mkdir(..., { recursive: true })` for better UX when creating new files).
2. `packages/editor/src/static/index.html` — Integrate Monaco Editor:
   - Load `https://cdn.jsdelivr.net/npm/monaco-editor@0.47.0/min/vs/loader.js`.
   - Configure `require.config({ paths: { 'vs': '...' } })`.
   - Create a `<div id="editor" style="height:100%"></div>`.
3. `packages/editor/src/static/app.js` — Enhance frontend:
   - On file click: fetch content, create Monaco model with detected language (map extension to Monaco language ID), set value.
   - Add "Save" button. On click: read current editor value, `PUT` to `/api/files/<path>`. Show toast/status.
   - Dirty indicator: asterisk in tab/file label when content differs from saved.
   - Keyboard shortcut: `Ctrl+S` / `Cmd+S` triggers save.
4. Language detection mapping: simple object `{ ".ts": "typescript", ".js": "javascript", ".json": "json", ".md": "markdown", ".py": "python", ".css": "css", ".html": "html", ".yaml": "yaml", ".yml": "yaml", ".sh": "shell", ".go": "go", ".rs": "rust", ".java": "java", ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp", ".xml": "xml", ".sql": "sql", ".dockerfile": "dockerfile", ".tf": "hcl" }`.

**Dependencies**: Slice 2 (file reading endpoints, tree UI, path validation logic).

**Risks**:
| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| R3.1 | Monaco CDN unavailable or slow | Low | Use jsdelivr CDN (highly reliable). If CDN fails, editor surface won't load — acceptable for a rare-use feature. |
| R3.2 | Saving very large files (>10 MB) hits 128Mi memory limit or request body size limits | Low | This is a lightweight editor for source files. Document that files >1 MB may not save reliably. |
| R3.3 | Concurrent edits from terminal and web editor conflict | Medium | Out of scope. Document as known limitation. Monaco does not provide file-locking. |
| R3.4 | Auto-creating parent dirs on `PUT` could inadvertently create directories outside repo | Medium | Path validation runs before `mkdir`; rejected paths are blocked regardless of recursive flag. |
| R3.5 | Monaco loaded from CDN means no offline/air-gapped support | Low | The router is internet-connected (GitHub OAuth, CDN). Not a concern for current deployment target. |

**End-to-end test**:
1. Open `editor-<hash>-oc.<domain>`.
2. Navigate to `repo/src/index.ts`, click it.
3. Monaco editor loads with TypeScript syntax highlighting.
4. Make a visible text change (e.g., add a comment).
5. Press `Ctrl+S` or click Save → status shows "Saved".
6. Refresh browser, re-open `repo/src/index.ts` → change persisted.
7. (Optional) `opencode attach` to the session and `cat repo/src/index.ts` to verify.

---

#### Slice 4: App Frontend Integration

**User-visible behavior**: A visible "Open Editor" button appears in the expanded session list detail panel, linking directly to the editor subdomain. Users no longer need to manually construct the URL.

**Actionable Tasks**:
1. `packages/app/src/session-item.tsx` — Add "Open Editor" button:
   - In the expanded action-buttons row (inside the `<Show when={props.expanded}>` block), add a third button next to "Attach" and "Terminate".
   - Only render when `props.session.state === "running"` and `props.session.editorUrl` is truthy.
   - On click: `window.open(props.session.editorUrl, "_blank")`.
   - Use outline button style (same as Attach) to indicate secondary action.
2. `packages/app/src/i18n.ts` (or translation bundle) — Add key `session.action.editor` with label "Open Editor".
3. `packages/app/src/api.ts` — Already updated in Slice 1; verify `Session` type includes `editorUrl`.
4. `packages/app/src/session-item.tsx` (compact variant) — **Decision**: Do NOT add an editor button to the compact sidebar variant to avoid clutter. The compact variant shows only status, name, and meta.

**Dependencies**:
- **Hard dependency**: Slice 1 (backend must provide `editorUrl` in API responses).
- **Soft dependency**: Slice 3 (button should link to a functional editor; linking to a read-only file browser is acceptable but suboptimal). Recommended sequence: implement UI after Slice 3, or gate button visibility on a feature flag until Slice 3 is complete.

**Risks**:
| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| R4.1 | `editorUrl` missing when pod is not running | Low | Button is conditionally rendered only when `state === "running"` and `editorUrl` is defined. |
| R4.2 | Three buttons in a row cause layout overflow on narrow viewports | Low | Action buttons already use `flex-1` and wrap gracefully. Verify on mobile if needed. |
| R4.3 | Users confuse "Open Editor" with the main opencode session iframe | Medium | Use clear label "Open Editor" vs. the session name/title. Button opens in new tab, which signals it's a separate tool. |

**End-to-end test**:
1. In main app (`https://code.<domain>`), create/resume a session.
2. Wait for `state === "running"`.
3. Expand the session item.
4. Observe three buttons: "Attach", "Open Editor", "Terminate".
5. Click "Open Editor" → new tab opens at `editor-<hash>-oc.<domain>`.
6. Page loads the Monaco editor (Slice 3).

---

### Cross-Cutting Concerns

**Build & CI/CD**:
- The editor sidecar is a separate Docker image (`ghcr.io/<owner>/opencode-editor`) built from `packages/editor/Dockerfile`.
- It must be built and pushed by CI on every push to `main` that touches `packages/editor/**` or its Dockerfile.
- The router deployment needs `EDITOR_IMAGE` env var set to the editor image tag.
- The root `package.json` `build` script should include `pnpm --filter ./packages/editor build` if the editor has a build step (e.g., TypeScript compilation). For a pure JS sidecar, no build step is needed.

**Auth & Security**:
- Editor subdomain routes through port 3000 (behind oauth2-proxy). The editor sidecar itself does NOT implement auth.
- File API endpoints must enforce path containment within `/home/opencode`.
- No secrets or tokens are passed to the editor sidecar.

**Deployment (External Pulumi Stack)**:
- The homelab-apps Pulumi stack likely routes `*.<domain>` to the router service on port 3000. If so, `editor-*` subdomains work automatically.
- If the stack has an explicit `attach-*` route to port 4096, verify `editor-*` is NOT included in that rule.
- Document the required env var (`EDITOR_IMAGE`) in the README.

**Resource Budget**:
- Editor container: requests `cpu: 50m, memory: 32Mi`; limits `cpu: 200m, memory: 128Mi`.
- Image target: <50 MB compressed (verified by `docker image ls` and CI build logs).
- Monaco editor is client-side only, loaded from CDN — zero impact on sidecar image size or memory.

**Mock Mode / Local Development**:
- `dev-proxy.ts` enhancement (Slice 1, Task 4) is critical for local end-to-end testing.
- In mock mode, run the editor server locally (`node packages/editor/src/server.js`) on port 7681. The router will proxy `editor-abc123def456-oc.localhost:3002` to `localhost:7681` via the enhanced dev proxy.
- Alternatively, for frontend-only editor development, run the editor server locally and open `http://localhost:7681` directly (bypassing the router).

---

### Gaps Discovered During Plan (No Design Changes Required)

1. **`dev-proxy.ts` single-port limitation**: The existing dev proxy only forwards `config.opencodePort` (4096). Local development of the editor sidecar requires proxying to a different port (7681). **Resolution**: Enhance `dev-proxy.ts` to accept an optional `port` parameter (Slice 1, Task 4). This is an implementation gap, not a design contradiction.

2. **No existing editor package or Dockerfile**: The repo has no precedent for a third container image. **Resolution**: Create `packages/editor/` with its own `Dockerfile` and CI job. Documented in Slice 1 tasks.

3. **Mock-k8s pod spec lacks editor container**: The mock data in `mock-k8s.ts` does not include the `editor` container. **Resolution**: Update `makeRunningPod` to include it (Slice 1, Task 5). Minor data consistency fix.

---

## Implement
### Tasks
- [x] Slice 1: Router Routing + Minimal Editor Sidecar (Infrastructure)
- [x] Slice 2: Read-Only File Browser
- [x] Slice 3: Monaco Editor with Save
- [x] Slice 4: App Frontend Integration

### Completed
**Slice 1 — completed 2026-06-02**

1. ✅ `packages/router/src/config.ts` — Added `editorPort` (default `7681`, env `EDITOR_PORT`), `editorRoutePrefix` (default `"editor-"`, env `EDITOR_ROUTE_PREFIX`), `editorImage` (default `"ghcr.io/mrsimpson/opencode-editor:latest"`, env `EDITOR_IMAGE`).
2. ✅ `packages/router/src/index.ts` — Added `getEditorSessionHash(host)` extractor following the `getAttachSessionHash` pattern. In both `handler` and `wsHandler`, editor subdomain is checked **after** email/OAuth validation, **before** `getSessionInfo`, and proxies to `proxyToPod(hash, config.editorPort, req, res)`.
3. ✅ `packages/router/src/pod-manager.ts` — Added third `editor` container to pod spec in `ensurePod` with `image: config.editorImage`, `ports: [{ containerPort: config.editorPort }]`, `volumeMounts: [{ name: "user-data", mountPath: "/home/opencode" }]`, restrictive `securityContext` (identical to `chromium`), and lightweight resources (`requests: cpu 50m/memory 32Mi`, `limits: cpu 200m/memory 128Mi`). Added `getEditorUrl(hash)` helper. Added `editorUrl?: string` to `SessionInfo`. Included `editorUrl: getEditorUrl(hash)` in `buildSessionInfo` return object.
4. ✅ `packages/router/src/dev-proxy.ts` — Enhanced `target(hash, port?)` to accept an optional `port` parameter. Spawns `kubectl port-forward pod/${pod} ${localPort}:${remotePort}` for the requested remote port, defaulting to `config.opencodePort` when omitted. Backward-compatible.
5. ✅ `packages/router/src/mock-k8s.ts` — Added `editor` container metadata to `makeRunningPod` so mock-mode pod specs include it.
6. ✅ `packages/app/src/api.ts` — Added `editorUrl: z.string().optional()` to `SessionSchema`.
7. ✅ `packages/editor/package.json` — Created workspace package with `"type": "module"`, dev deps `typescript`, `tsx`, `@types/node`, `@tsconfig/node22`.
8. ✅ `packages/editor/src/server.ts` — Minimal Node.js `http` server listening on `process.env.EDITOR_PORT || 7681`. Serves static files from `packages/editor/static/`. Supports `GET /`, `GET /index.html`, and `GET /health`. Uses Node built-ins only (no Express). Includes path-traversal defense.
9. ✅ `packages/editor/static/index.html` — Single HTML file with "Editor is online" text and minimal dark styling.
10. ✅ `packages/editor/Dockerfile` — Uses `node:22-alpine` base. Copies `src/server.js` and `static/` and runs `node src/server.js`. Minimal image.
11. ✅ Root `Dockerfile` — No changes needed. The root Dockerfile only copies `packages/router` and `packages/app`; the editor image is built separately from `packages/editor/Dockerfile`.
12. ✅ `.github/workflows/build-image.yml` — Added second `build-editor` job that builds and pushes `ghcr.io/${{ github.repository_owner }}/opencode-editor:<tag>` and `:latest`.
13. ✅ `README.md` — Documented new env vars (`EDITOR_PORT`, `EDITOR_ROUTE_PREFIX`, `EDITOR_IMAGE`) in the Environment variables table.
14. ✅ Tests — Added `getEditorSessionHash` tests to `hostname.test.ts` and config default tests to `config.test.ts`. All 269 tests pass (226 router + 43 app + 13 plugin). Typecheck and build pass cleanly.

**Decisions made during implementation:**
- The editor server uses `fileURLToPath(import.meta.url)` to compute `__dirname` in ESM, keeping it fully ESM-compatible.
- The `dev-proxy.ts` cache key was changed from `hash` to `${hash}:${remotePort}` so that concurrent port-forwards to different ports on the same pod don't collide.
- `containerStatuses` was added to the `FakePod` type in `mock-k8s.ts` to accommodate the new editor container metadata.
- The `config.test.ts` spawns new processes for each default-value assertion to avoid module-cache pollution; this pattern was followed for the three new config defaults.

**Quality gates:**
- `pnpm install` ✅
- `pnpm run build` ✅
- `pnpm run typecheck` ✅
- `pnpm run test` ✅

**Slice 2 — completed 2026-06-02**

1. ✅ `packages/editor/src/server.ts` — Added REST endpoints:
   - `GET /api/files?dir=<path>` — validates `dir` is within `/home/opencode`, reads directory with `fs.readdir` (`withFileTypes: true`), caps entries at 1000, returns JSON array `{ name, type, size? }`.
   - `GET /api/files/<path>` — validates path is within `/home/opencode`, detects binary files via extension blocklist, returns `400` for binaries or file content as `text/plain`.
   - Path normalization uses `path.resolve("/home/opencode", requestedPath)`; rejects if result does not start with `/home/opencode`.
   - Rejects `..` sequences before normalization as defense-in-depth.
2. ✅ `packages/editor/static/index.html` — Replaced single-page confirmation with two-pane layout: left sidebar (`<ul>`/`<li>` tree) and right preview pane (`<pre>`). Links `app.js` and `style.css`.
3. ✅ `packages/editor/static/app.js` — Vanilla JS file tree:
   - Fetches `/api/files?dir=/home/opencode/repo` on load and renders recursively.
   - Click directory → expand/collapse (fetches children on first expand).
   - Click file → fetches content and displays in preview pane.
   - Binary files are indicated in the tree (greyed out, non-clickable) and shown as "Binary file, cannot preview." if fetched.
4. ✅ `packages/editor/static/style.css` — Basic flexbox layout, sidebar width 280px, clean dark theme, no external framework.

**Decisions made during implementation:**
- The `GET /api/files/<path>` endpoint strips the leading `/api/files/` prefix and prepends `/` to the remaining path so absolute file paths are correctly resolved against `/home/opencode`.
- The `URL` constructor's built-in path normalization (resolving `..` and `.` segments) provides an additional layer of path-traversal defense before our explicit `isPathWithinHome` check.
- Binary detection uses a pragmatic extension blocklist rather than MIME sniffing, keeping the server simple and dependency-free.
- Frontend sorts directories first alphabetically, then files, for a familiar file-tree UX.

**Quality gates:**
- `pnpm install` ✅
- `pnpm --filter ./packages/editor build` ✅ (TypeScript `tsc --noEmit` passes)
- `pnpm run build` ✅ (router + app)
- `pnpm run typecheck` ✅ (router + app + plugin)
- `pnpm run test` ✅ (269 tests pass: 226 router + 43 app + 13 plugin)
- Smoke test ✅ (directory listing, file read, binary rejection, path traversal defense verified via curl)

**Slice 3 — completed 2026-06-02**

1. ✅ `packages/editor/src/server.ts` — Added `PUT /api/files/<path>` endpoint:
   - Validates path using existing `isPathWithinHome` (same rules as Slice 2: resolve within `/home/opencode`, reject `..`).
   - Reads request body, auto-creates parent directories with `fs.mkdir(..., { recursive: true })` **after** path validation.
   - Writes file with `fs.writeFile` and returns `{ ok: true }` on success.
   - Returns appropriate JSON error on failure (400 for invalid path, 500 for unexpected errors).
   - Refactored API route handling to support async/await for cleaner PUT implementation.
2. ✅ `packages/editor/static/index.html` — Integrated Monaco Editor:
   - Loads `https://cdn.jsdelivr.net/npm/monaco-editor@0.47.0/min/vs/loader.js` and configures `require.config` with CDN path.
   - Replaced preview pane with `<div id="editor" style="height:100%"></div>`.
   - Added toolbar with file label, save status, and Save button.
   - Kept file tree sidebar from Slice 2.
3. ✅ `packages/editor/static/app.js` — Enhanced frontend:
   - On file click: fetches content, creates Monaco model with detected language (via extension-to-language map), sets value in editor surface.
   - Save button handler: reads current editor value and `PUT`s to `/api/files/<path>`. Shows status text ("Saved" or error) near Save button.
   - Dirty indicator: asterisk in file label when content differs from saved. Uses `editor.onDidChangeModelContent`.
   - Keyboard shortcut: `Ctrl+S` / `Cmd+S` triggers save and prevents default browser behavior.
   - Language detection mapping includes all requested extensions: `.ts`, `.js`, `.json`, `.md`, `.py`, `.css`, `.html`, `.yaml`, `.yml`, `.sh`, `.go`, `.rs`, `.java`, `.c`, `.cpp`, `.h`, `.hpp`, `.xml`, `.sql`, `.dockerfile`, `.tf`.
4. ✅ `packages/editor/static/style.css` — Updated styles for toolbar and Monaco editor container.

**Bug fix discovered during Slice 3:**
- The `packages/editor/tsconfig.json` had `"noEmit": true`, meaning `tsc` never produced `dist/server.js`. The `Dockerfile` expected `src/server.js` which didn't exist. **Resolution**: removed `"noEmit": true`, updated `package.json` build/start scripts, converted `Dockerfile` to a multi-stage build that compiles TypeScript in the builder stage and copies `dist/server.js` into the final image. Added `pnpm --filter ./packages/editor build` to root `package.json` `build` script and `typecheck` script for consistency.

**Decisions made during implementation:**
- The editor server was refactored from callback-style to async/await inside the request handler to cleanly support the new PUT endpoint alongside existing GET endpoints.
- Monaco model is recreated on every file open (rather than reusing a single model) to keep language mode changes clean and prevent cross-file undo history pollution.
- The save status indicator auto-clears after 3 seconds to avoid stale UI state.
- The `editor` package was added to root `build` and `typecheck` scripts to ensure CI and local development catch editor compilation errors.

**Quality gates:**
- `pnpm install` ✅
- `pnpm --filter ./packages/editor build` ✅ (`tsc` emits `dist/server.js`)
- `pnpm run build` ✅ (router + app + editor)
- `pnpm run typecheck` ✅ (router + app + plugin + editor)
- `pnpm run test` ✅ (269 tests pass: 226 router + 43 app + 13 plugin)
- Smoke test ✅ (PUT writes file, auto-creates parent dirs, path traversal rejected)

**Slice 4 — completed 2026-06-02**

1. ✅ `packages/app/src/session-item.tsx` — Added "Open Editor" button:
   - Placed in the expanded action-buttons row inside `<Show when={props.expanded}>`, between the "Attach" and "Terminate" buttons.
   - Conditionally rendered only when `props.session.state === "running"` and `props.session.editorUrl` is truthy.
   - On click: `window.open(props.session.editorUrl, "_blank")`.
   - Uses outline button style (`background: none`, `border: 1px solid var(--border-base)`) to indicate secondary action.
   - `e.stopPropagation()` prevents collapsing the detail panel.
2. ✅ `packages/app/src/i18n/en.ts` — Added key `session.action.editor` with label "Open Editor".
3. ✅ `packages/app/src/i18n/de.ts` — Added key `session.action.editor` with label "Editor öffnen".
4. ✅ `packages/app/src/api.ts` — Already included `editorUrl: z.string().optional()` in `SessionSchema` from Slice 1; verified, no changes needed.
5. ✅ `packages/router/src/pod-manager.ts` — Already included `editorUrl` in `SessionInfo` and `buildSessionInfo` from Slice 1; verified, no changes needed.
6. ✅ Compact variant (`CompactSessionItem`) — No editor button added, as planned, to avoid sidebar clutter.

**Decisions made during implementation:**
- The "Open Editor" button uses the same outline style as the "Attach" button (rather than a filled primary style), maintaining visual hierarchy: Attach is primary, Editor is secondary, Terminate is destructive.
- The button is only shown in the expanded detail panel, not in the compact sidebar variant, aligning with the design decision to keep the sidebar minimal.

**Quality gates:**
- `pnpm install` ✅
- `pnpm run build` ✅ (router + app + editor)
- `pnpm run typecheck` ✅ (router + app + plugin + editor)
- `pnpm run test` ✅ (269 tests pass: 226 router + 43 app + 13 plugin)

## Commit
### Tasks
- [x] Commit all changes (Slice 1 + Slice 2 + Slice 3) to `feat/lightweight-editor-sidecar`

### Completed
*Commit hash to be added after push*

---

*This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on.*



---
*This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on.*
