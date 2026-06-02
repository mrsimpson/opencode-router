# opencode-router

A lightweight Kubernetes-native router that gives every user a **disposable, fully isolated [opencode](https://opencode.ai) session** — think Claude.ai Code-style web sessions, self-hosted on your own cluster.

## What this enables

opencode is an AI coding agent that runs in a terminal. opencode-router brings it to the browser: each user gets an isolated pod running opencode, pre-configured with the repository of their choice, accessible via a unique subdomain — no local setup needed.

**Key capabilities:**

- **Disposable sessions** — create a session from any GitHub repository in seconds; the pod is provisioned on demand and cleaned up automatically after it goes idle
- **Full isolation** — each session runs in its own Kubernetes pod with its own PVC (persistent volume), RBAC scope, and secrets; sessions cannot access each other
- **Pre-configured environments** — the opencode image baked into each pod includes skills, agent config, and tool defaults; operators inject additional config via a ConfigMap
- **Subdomain-based routing** — each session gets its own subdomain (`<hash>-oc.<domain>`) so the browser iframe points directly at the opencode web UI running inside the pod; no port conflicts
- **Idle cleanup** — pods that have been inactive longer than a configurable timeout are automatically terminated; persistent volumes survive so work is not lost
- **Local client attach** — users can `opencode attach` from their terminal to connect to a running cloud session using password auth on a separate attach endpoint
- **Progress streaming** — session startup stages (initializing → configuring → cloning → starting) are streamed to the browser in real time via SSE
- **Per-user secrets** — users can store environment variables (e.g. API keys) that are injected into every pod they start, via an encrypted Kubernetes Secret

## Architecture

```
Browser
  │
  ├── GET /              → setup UI (SolidJS SPA)
  ├── /api/*             → REST + SSE API (session lifecycle, secrets, repos)
  │
  └── <hash>-oc.<domain> → reverse proxy → pod:4096 (opencode web UI)

opencode-router (this repo)
  ├── packages/router    Node.js HTTP/WebSocket reverse proxy + k8s pod manager
  ├── packages/app       SolidJS SPA (session list, create/resume, settings)
  ├── packages/plugin    opencode plugin (pushes progress events from pod → router)
  └── packages/ui        Custom opencode-style UI components (OC-2 design tokens)

Kubernetes (namespace: code)
  ├── ServiceAccount + Role + RoleBinding  (pods, pvcs, secrets CRUD in namespace)
  ├── PVC per session                      (persists workspace across pod restarts)
  └── Pod per running session              (init container: git clone; main: opencode serve)
```

## Getting started

### Prerequisites

| Requirement | Notes |
|---|---|
| Kubernetes cluster | k3s, k8s, GKE, EKS — any distribution works |
| Persistent storage | A `StorageClass` that supports `ReadWriteOnce` (e.g. `longhorn`, `local-path`) |
| Wildcard DNS + TLS | Sessions live at `*.<domain>` — you need a wildcard DNS record and a wildcard TLS certificate covering that subdomain |
| opencode image | A container image with `opencode serve` as the entrypoint — see [Choosing an opencode image](#choosing-an-opencode-image) below |
| Auth proxy | The router trusts the `X-Auth-Request-Email` header from an upstream auth proxy (e.g. oauth2-proxy). Without it, set `DEV_EMAIL` for local dev only. |

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENCODE_IMAGE` | ✅ | — | OCI image used for session pods — must run `opencode serve` as its entrypoint and run as a non-root user (UID 1000). See [Choosing an opencode image](#choosing-an-opencode-image). |
| `ROUTER_DOMAIN` | ✅ | — | Base domain for the router and sessions (e.g. `code.example.com`) |
| `OPENCODE_NAMESPACE` | | `opencode` | Kubernetes namespace where pods and PVCs are created |
| `PORT` | | `3000` | HTTP port the router listens on |
| `IDLE_TIMEOUT_MINUTES` | | `15` | Minutes of inactivity before a pod is terminated |
| `STORAGE_CLASS` | | _(cluster default)_ | StorageClass for session PVCs |
| `STORAGE_SIZE` | | `2Gi` | PVC size per session |
| `ROUTE_SUFFIX` | | `""` | Subdomain suffix, e.g. `-oc` → `<hash>-oc.<domain>` |
| `ROUTER_PROTO` | | `https` | Protocol for public session URLs (`http` for local dev) |
| `OPENCODE_ROUTER_URL` | | — | In-cluster URL for the plugin to push events back to the router |
| `OPENCODE_ROUTER_EXTERNAL_DOMAIN` | | — | External domain injected into pods for port-forward URL construction |
| `API_KEY_SECRET_NAME` | | `opencode-api-keys` | Name of the Secret holding LLM API keys |
| `CONFIG_MAP_NAME` | | `opencode-config-dir` | ConfigMap with opencode config files merged into each pod |
| `IMAGE_PULL_SECRET_NAME` | | — | imagePullSecret for private registries |
| `ATTACH_PORT` | | `4096` | Port for the `opencode attach` endpoint (separate from the main HTTP server) |
| `EDITOR_PORT` | | `7681` | Port the editor sidecar listens on inside the session pod |
| `EDITOR_ROUTE_PREFIX` | | `editor-` | Prefix for editor session subdomains (e.g. `editor-<hash>-oc.<domain>`) |
| `EDITOR_IMAGE` | | `ghcr.io/mrsimpson/opencode-editor:latest` | OCI image for the editor sidecar container |
| `ADMIN_SECRET` | | — | Secret for admin endpoints (e.g. image pre-pull). Optional. |
| `DEBUG_HEADERS` | | `false` | Log all incoming request headers (useful for diagnosing missing auth headers) |

### Choosing an opencode image

The router requires an OCI image that:
1. Runs `opencode serve` as its entrypoint
2. Runs as a **non-root user** (the homelab k8s namespace enforces `restricted` Pod Security Standards which reject UID 0 containers)
3. Has `HOME=/home/<user>` set — the router's init container seeds config and clones repos into that home directory

#### Why not the upstream `ghcr.io/anomalyco/opencode` image?

The upstream image (Alpine-based, minimal) **runs as root** — there is no `USER` directive in its Dockerfile. It also has no `git`, `node`, `python`, `gh`, `ripgrep`, or other dev tools, and no baked-in config defaults or the router plugin. It cannot be used directly.

#### Why not the Docker sandbox template (`docker/sandbox-templates:opencode`)?

Docker's official sandbox template is built for the `sbx` CLI runtime, not Kubernetes: it's 700MB, uses a different home directory (`/home/agent`), and is designed for TUI mode only. It also has no router plugin or custom skills.

#### Recommended: a layered fork image

The [mrsimpson/opencode](https://github.com/mrsimpson/opencode) fork maintains a custom image (`ghcr.io/mrsimpson/opencode`) built on top of the upstream Alpine binary. It adds:

- **Non-root user** `opencode` (UID 1000) — required for k8s `restricted` PSS ✅
- **Dev tools**: `git`, `bash`, `nodejs`, `npm`, `pnpm`, `python3`, `jq`, `ripgrep`, `gh`, `bun`
- **`bd` (beads)** task management CLI — used by opencode agents for structured work tracking
- **Router plugin** baked at `/etc/opencode-plugin/` — pushed progress events without any `npm install` in the pod
- **Default config** baked at `/etc/opencode-defaults/` — skills, agents, opencode.json, init-scripts
- **MCP servers** pre-installed: `@codemcp/knowledge-server`, `@codemcp/skills-server`, `@playwright/cli`
- **`bind-all-interfaces` Node.js patch** — dev servers bind `0.0.0.0` not `localhost`, so they're reachable across pods
- **musl PTY library** — enables bun's terminal emulation on Alpine

The image is tagged `ghcr.io/mrsimpson/opencode:<version>-main.<sha7>` and rebuilt whenever upstream opencode releases a new version (via a manual `upstream-merge` workflow that opens a PR, then CI rebuilds on merge). `:latest` always points to the most recent build.

**Upgrade strategy**: use Renovate (or the homelab-apps `deploy-opencode-router.yml` workflow dispatch) to update `code:opencodeImage` in `Pulumi.dev.yaml` when a new image is published. The `build-opencode-image.yml` workflow in the fork can also pre-pull the new image on the running router via the `/api/admin/pull-image` endpoint to warm the node cache before deploying.

### Local development (no cluster)

The mock mode pre-seeds three fake sessions so you can iterate on the UI without a real cluster:

```bash
# 1. Install dependencies
pnpm install

# 2. Start router in mock mode (no kubeconfig needed)
pnpm dev:mock          # router on http://localhost:3002

# 3. In a second terminal, start the SPA dev server
pnpm dev:app           # Vite on http://localhost:5173

# 4. Open http://localhost:3002
```

### Local development (real cluster)

```bash
# 1. Generate a short-lived kubeconfig
./scripts/create-local-kubeconfig.sh

# 2. Copy and edit the example env file
cp packages/router/.env.local.example packages/router/.env.local
# Set KUBECONFIG, OPENCODE_IMAGE, and optionally DEV_POD_PROXY_TARGET

# 3. Start both servers
pnpm dev:router        # from repo root
pnpm dev:app           # in a second terminal
```

Open `http://localhost:3002`. Session subdomains resolve via the browser's built-in `*.localhost → 127.0.0.1` behaviour — no `/etc/hosts` needed.

### Production deployment

The recommended deployment target is Kubernetes via Pulumi. A ready-to-use Pulumi stack for homelab environments is maintained in **[homelab-apps/apps/opencode-router](https://github.com/digitaleraluhut/homelab-apps/tree/main/apps/opencode-router)**.

The stack provisions:

- Kubernetes namespace with Pod Security Standards enforced (`restricted`)
- Deployment + Service for the router
- ServiceAccount + Role + RoleBinding scoped to the `code` namespace
- Ingress / IngressRoute with oauth2-proxy authentication
- Session subdomains via Cloudflare Tunnel + Cloudflare operator sidecar
- Secrets for LLM API keys (OpenRouter) and Cloudflare API token
- ConfigMap for opencode defaults (models, skills, agent config)

See the [homelab-apps stack](https://github.com/digitaleraluhut/homelab-apps/tree/main/apps/opencode-router) for full configuration reference.

## CI/CD

On every push to `main`, GitHub Actions:

1. Builds the Docker image and pushes it to GHCR as `ghcr.io/<owner>/opencode-router:<version>-main.<sha7>` and `:latest`
2. Optionally dispatches the `deploy-opencode-router` workflow in `homelab-apps` (requires `HOMELAB_APPS_PAT` secret — a fine-grained PAT with _Actions: write_ on the target repo)

If `HOMELAB_APPS_PAT` is not configured, the build step prints the `gh workflow run` command you can run manually.

## Packages

| Package | Description |
|---|---|
| `packages/router` | Node.js HTTP/WS reverse proxy, k8s pod manager, REST + SSE API |
| `packages/app` | SolidJS SPA — session list, create/resume form, settings dialog |
| `packages/plugin` | opencode plugin loaded inside each pod; pushes progress events to the router |
| `packages/ui` | Standalone opencode-style UI components using OC-2 design tokens |

## License

MIT
