# Deploying opencode-router on Kubernetes

This guide describes everything needed to deploy the opencode-router and its setup UI on a Kubernetes cluster. It is written for an agent or engineer translating this into infrastructure-as-code (Pulumi, Terraform, Helm, raw manifests, etc.).

## System Overview

The opencode-router provides per-user isolated OpenCode instances on Kubernetes. The full request path is:

```
Internet → Ingress → oauth2-proxy (authentication) → opencode-router → per-user Pod
```

The router is a mostly stateless Node.js process that:
- Reads the authenticated user's email from the `X-Auth-Request-Email` header
- Serves a setup UI (SolidJS SPA) on first visit so the user can pick a git repo to clone
- Provisions a PersistentVolumeClaim and Pod per user via the Kubernetes API
- Proxies all HTTP and WebSocket traffic to the user's running Pod
- Deletes idle Pods after a timeout (PVCs are preserved)

The one local state exception is the `/data/history` volume used to store session archive JSON files exported before pod deletion.

The router image includes the pre-built SPA in `/app/public/`. There is one Docker image for both the router and UI — no separate deployment for the frontend.

## Prerequisites

1. **A Kubernetes cluster** (1.26+) with a working StorageClass for dynamic PVC provisioning
2. **An Ingress controller** (Traefik, nginx-ingress, etc.) with TLS
3. **An authentication proxy** — oauth2-proxy or equivalent that:
   - Authenticates users via GitHub, Google, OIDC, etc.
   - Sets the `X-Auth-Request-Email` header on every request forwarded to the backend
4. **The OpenCode Docker image** — the image that runs `opencode serve` (the application being proxied to)
5. **DNS** — a domain name pointing to the Ingress (e.g. `opencode.example.com`)

## Namespace

Create a dedicated namespace. All resources (router, user pods, PVCs, secrets, configmaps) live in this single namespace.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: opencode
```

All resources below assume `namespace: opencode`. The router defaults to this name but it is configurable via `OPENCODE_NAMESPACE`.

## 1. RBAC — ServiceAccount, Role, RoleBinding

The router runs as a Pod that calls the Kubernetes API to manage user Pods and PVCs. It needs a ServiceAccount with a Role scoped to its namespace.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: opencode-router
  namespace: opencode
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: opencode-router
  namespace: opencode
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "create", "delete", "patch"]
  - apiGroups: [""]
    resources: ["pods/exec"]
    verbs: ["create", "get"]
  - apiGroups: [""]
    resources: ["persistentvolumeclaims"]
    verbs: ["get", "list", "create"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get", "create", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: opencode-router
  namespace: opencode
subjects:
  - kind: ServiceAccount
    name: opencode-router
    namespace: opencode
roleRef:
  kind: Role
  name: opencode-router
  apiGroup: rbac.authorization.k8s.io
```

**Why these exact permissions:**
- `pods: get` — check if a user's pod exists and read its IP
- `pods: list` — enumerate all managed pods for idle cleanup (filtered by label `app.kubernetes.io/managed-by=opencode-router`)
- `pods: create` — provision new user pods
- `pods: delete` — delete idle pods during cleanup
- `pods: patch` — update the `opencode.ai/last-activity` annotation on each proxied request (throttled to once/minute/user)
- `pods/exec: create, get` — run `opencode export <sessionId>` inside session pods before deletion to archive session data (the k8s client uses GET for the WebSocket handshake)
- `persistentvolumeclaims: get` — check if a user's PVC exists before creating
- `persistentvolumeclaims: create` — provision PVCs for new users
- `persistentvolumeclaims: list` — not strictly required currently but included for operational tooling
- `secrets: get/create/patch/delete` — manage per-session `opencode-github-<hash>` Secrets that hold the user's GitHub OAuth token so git operations inside the pod are authenticated

The Role is namespace-scoped (not a ClusterRole) — the router can only manage resources in its own namespace.

## 2. Secret — API Keys

The router injects API keys into every user Pod via `envFrom: secretRef`. Each key in the Secret becomes an environment variable in the user Pod.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: opencode-api-keys
  namespace: opencode
type: Opaque
stringData:
  ANTHROPIC_API_KEY: "sk-ant-..."
  # Add any other provider keys the opencode instance needs:
  # OPENAI_API_KEY: "sk-..."
  # GOOGLE_API_KEY: "..."
```

**The Secret name is configurable** via the router's `API_KEY_SECRET_NAME` env var (default: `opencode-api-keys`). The name in the Secret metadata must match.

**Security note:** Every user Pod gets the same API keys. The router does not support per-user API keys — all users share the organization's keys. If per-user keys are needed, OpenCode's own auth/key configuration would need to handle that.

## 3. ConfigMap — Shared OpenCode Configuration

OpenCode reads its configuration from `~/.opencode/`. The router mounts a ConfigMap at `/root/.opencode` (read-only) in every user Pod, so all users share the same agent configuration.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: opencode-config-dir
  namespace: opencode
data:
  opencode.json: |
    {
      "model": {
        "default": "claude-sonnet-4-20250514"
      }
    }
```

**The ConfigMap name is configurable** via `CONFIG_MAP_NAME` (default: `opencode-config-dir`).

The keys in the ConfigMap become files in `/root/.opencode/`. At minimum, `opencode.json` should be present. Add any other config files OpenCode expects (e.g. custom agent instructions).

**Note:** The ConfigMap is mounted read-only. OpenCode will read this config but cannot modify it. Per-user config overrides would need to live on the user's PVC.

## 4. Router Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: opencode-router
  namespace: opencode
spec:
  replicas: 2
  selector:
    matchLabels:
      app: opencode-router
  template:
    metadata:
      labels:
        app: opencode-router
    spec:
      serviceAccountName: opencode-router
      volumes:
        - name: session-history
          emptyDir: {}
      containers:
        - name: router
          image: <your-registry>/opencode-router:latest  # See "Building the Image" below
          ports:
            - containerPort: 3000
          volumeMounts:
            - name: session-history
              mountPath: /data/history
          env:
            - name: OPENCODE_IMAGE
              value: "<your-registry>/opencode:latest"
            # Optional overrides (showing defaults):
            # - name: OPENCODE_NAMESPACE
            #   value: "opencode"
            # - name: PORT
            #   value: "3000"
            # - name: IDLE_TIMEOUT_MINUTES
            #   value: "30"
            # - name: API_KEY_SECRET_NAME
            #   value: "opencode-api-keys"
            # - name: CONFIG_MAP_NAME
            #   value: "opencode-config-dir"
            # - name: STORAGE_CLASS
            #   value: ""              # empty = cluster default StorageClass
            # - name: STORAGE_SIZE
            #   value: "2Gi"
            # - name: DEFAULT_GIT_REPO
            #   value: ""              # if set, users skip the repo selection UI
            # - name: ARCHIVE_DIR
            #   value: "/data/history"  # must match the EmptyDir volumeMount path above
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 256Mi
          readinessProbe:
            httpGet:
              path: /api/status
              port: 3000
              httpHeaders:
                - name: X-Auth-Request-Email
                  value: healthcheck@probe
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /api/status
              port: 3000
              httpHeaders:
                - name: X-Auth-Request-Email
                  value: healthcheck@probe
            initialDelaySeconds: 10
            periodSeconds: 30
```

### Environment Variables Reference

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `OPENCODE_IMAGE` | **Yes** | — | Docker image for user Pods (must be pullable by the cluster) |
| `OPENCODE_NAMESPACE` | No | `opencode` | Namespace where user Pods and PVCs are created |
| `PORT` | No | `3000` | Port the router listens on |
| `IDLE_TIMEOUT_MINUTES` | No | `30` | Minutes of inactivity before a user's Pod is deleted |
| `API_KEY_SECRET_NAME` | No | `opencode-api-keys` | Name of the Secret injected into user Pods |
| `CONFIG_MAP_NAME` | No | `opencode-config-dir` | Name of the ConfigMap mounted as `/root/.opencode` |
| `STORAGE_CLASS` | No | `""` (cluster default) | StorageClass for user PVCs |
| `STORAGE_SIZE` | No | `2Gi` | Storage capacity per user PVC |
| `DEFAULT_GIT_REPO` | No | — | If set, all users get this repo auto-cloned; the setup UI is skipped |
| `PUBLIC_DIR` | No | `./public` | Path to the SPA assets directory (set automatically in the Docker image) |
| `ARCHIVE_DIR` | No | `/data/history` | Directory where session archive JSON files are written |
| `ARCHIVE_TIMEOUT_MS` | No | `30000` | Max time to wait for `opencode export` execution (ms) |
| `ARCHIVE_STRICT_MODE` | No | `false` | If `true`, export failure throws and blocks termination |
| `ARCHIVE_TEMP_POD_TIMEOUT_MS` | No | `120000` | Max time to wait for temporary export pod to reach Running state (ms) |
| `OPENCODE_MODEL_THINKING` | No | — | Model ID passed to the codemcp workflows `thinking` capability. See [Capability-aware model selection](#capability-aware-model-selection) below. |
| `OPENCODE_MODEL_CODING` | No | — | Model ID passed to the codemcp workflows `coding` capability. |
| `OPENCODE_MODEL_RESEARCH` | No | — | Model ID passed to the codemcp workflows `research` capability. |

### Capability-aware model selection

When `OPENCODE_MODEL_THINKING`, `OPENCODE_MODEL_CODING`, and/or
`OPENCODE_MODEL_RESEARCH` are set, the pod's init script invokes
`npx @codemcp/workflows setup capabilities opencode` with the provided values.
This generates per-capability agent files at
`.opencode/agents/<capability>.md` inside the cloned repo and writes a
`capability_models` map to `.vibe/config.yaml`. Any codemcp workflows
workflow that consumes the capability-routing hint then injects a
"Capability hint" into the LLM prompt that tells the agent which
capability it is operating as and which model to use.

For example, in the `epcc` workflow the phase→capability mapping is:
- `explore` → `research`
- `plan` → `thinking`
- `code` → `coding`
- `commit` → (unset)

The env vars can be set in two places, with the **per-user Secret taking
precedence** over the router Deployment when both are set:
- **Router Deployment** — applies to all pods cluster-wide. The router reads
  the env vars from its own environment and injects them into every pod's
  init and main containers.
- **Per-user Secret** — applies to a single user's pods. The user stores
  `OPENCODE_MODEL_*` in their per-user Secret (via the Secrets page in the
  web UI). The router injects them after the Deployment defaults (last-wins
  semantics), so they override the cluster default for that user.

When all three env vars are unset, the feature is a no-op (the wizard is not
invoked and pod startup time is unchanged). The wizard is non-fatal: if it
fails (e.g. no network for `npx`), opencode still starts, but the LLM will
not receive a capability hint.

Example homelab-apps Pulumi config (cluster-wide):

```yaml
configuration:
  code:opencodeRouter:
    env:
      - name: OPENCODE_MODEL_THINKING
        value: claude-opus-4-1
      - name: OPENCODE_MODEL_CODING
        value: claude-sonnet-4-5
      - name: OPENCODE_MODEL_RESEARCH
        value: claude-haiku-4-5
```

### Why 2 replicas

The router is mostly stateless — it discovers user Pods via the K8s API on every request. Multiple replicas provide availability. The only in-memory state is a throttle cache for activity annotations (once/min/user), which is non-critical — if a different replica handles the next request, it just writes the annotation slightly more often.

**Exception:** Session archives are stored in an `EmptyDir` volume mounted at `/data/history`. This means archives are local to each replica — a user terminating on replica A and listing archives on replica B will not see the archive. If cross-replica archive visibility is required, use session affinity (sticky sessions) or migrate to a shared `ReadWriteMany` PVC.

### Resource sizing

The router is lightweight: it proxies requests and makes K8s API calls. 128Mi memory is sufficient for hundreds of concurrent users. The per-user Pods (running `opencode serve`) are the primary resource consumers — size those according to the workload.

## 5. Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: opencode-router
  namespace: opencode
spec:
  selector:
    app: opencode-router
  ports:
    - port: 80
      targetPort: 3000
      protocol: TCP
```

This Service is the target for the Ingress/auth proxy. It does not need to be `type: LoadBalancer` — the Ingress controller handles external exposure.

## 6. Ingress + Authentication

The exact configuration depends on your Ingress controller and auth proxy. Below is a Traefik example using oauth2-proxy as ForwardAuth middleware. Adapt for nginx-ingress or other setups.

### oauth2-proxy Deployment (example)

oauth2-proxy handles authentication (GitHub, Google, OIDC, etc.) and sets the `X-Auth-Request-Email` header on authenticated requests.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oauth2-proxy
  namespace: opencode
spec:
  replicas: 1
  selector:
    matchLabels:
      app: oauth2-proxy
  template:
    metadata:
      labels:
        app: oauth2-proxy
    spec:
      containers:
        - name: oauth2-proxy
          image: quay.io/oauth2-proxy/oauth2-proxy:v7.7.1
          args:
            - --provider=github           # or google, oidc, etc.
            - --email-domain=*            # restrict to your org's domain if desired
            - --upstream=http://opencode-router.opencode.svc.cluster.local
            - --http-address=0.0.0.0:4180
            - --set-xauthrequest=true     # CRITICAL: sets X-Auth-Request-Email header
            - --pass-access-token=true    # REQUIRED: forwards GitHub token as X-Auth-Request-Token
            - --cookie-secure=true
            - --cookie-name=_opencode_oauth
          env:
            - name: OAUTH2_PROXY_CLIENT_ID
              valueFrom:
                secretKeyRef:
                  name: oauth2-proxy
                  key: client-id
            - name: OAUTH2_PROXY_CLIENT_SECRET
              valueFrom:
                secretKeyRef:
                  name: oauth2-proxy
                  key: client-secret
            - name: OAUTH2_PROXY_COOKIE_SECRET
              valueFrom:
                secretKeyRef:
                  name: oauth2-proxy
                  key: cookie-secret
          ports:
            - containerPort: 4180
---
apiVersion: v1
kind: Service
metadata:
  name: oauth2-proxy
  namespace: opencode
spec:
  selector:
    app: oauth2-proxy
  ports:
    - port: 4180
      targetPort: 4180
```

**Important oauth2-proxy config:**
- `--set-xauthrequest=true` is required — makes oauth2-proxy set the `X-Auth-Request-Email` header that the router reads
- `--pass-access-token=true` is required — forwards the GitHub OAuth token as `X-Auth-Request-Token`; the router stores this token in a per-session K8s Secret and mounts it into pods so `git push` and the `gh` CLI work inside the container
- `--upstream` points to the router Service
- Configure `--github-org` or `--email-domain` to restrict access to your organization

### Traefik ForwardAuth + IngressRoute (example)

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: oauth2-proxy
  namespace: opencode
spec:
  forwardAuth:
    address: http://oauth2-proxy.opencode.svc.cluster.local:4180/oauth2/auth
    trustForwardHeader: true
    authResponseHeaders:
      - X-Auth-Request-Email
---
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: opencode
  namespace: opencode
spec:
  entryPoints:
    - websecure
  routes:
    - match: Host(`opencode.example.com`)
      kind: Rule
      middlewares:
        - name: oauth2-proxy
      services:
        - name: opencode-router
          port: 80
  tls:
    certResolver: letsencrypt   # or your TLS configuration
```

### nginx-ingress alternative

If using nginx-ingress instead of Traefik:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: opencode
  namespace: opencode
  annotations:
    nginx.ingress.kubernetes.io/auth-url: "http://oauth2-proxy.opencode.svc.cluster.local:4180/oauth2/auth"
    nginx.ingress.kubernetes.io/auth-response-headers: "X-Auth-Request-Email"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    # WebSocket support:
    nginx.ingress.kubernetes.io/proxy-http-version: "1.1"
    nginx.ingress.kubernetes.io/configuration-snippet: |
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - opencode.example.com
      secretName: opencode-tls
  rules:
    - host: opencode.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: opencode-router
                port:
                  number: 80
```

**WebSocket support is critical.** OpenCode uses WebSockets for real-time UI updates and terminal PTY. The Ingress must:
- Support WebSocket upgrade (`Connection: Upgrade`)
- Have long read/send timeouts (at least 3600s) to keep WebSocket connections alive
- Forward the `X-Auth-Request-Email` header through the upgrade

## 7. Building the Docker Image

The router image is built from the monorepo root using the Dockerfile at `packages/opencode-router/Dockerfile`. It is a multi-stage build:

1. **Stage 1 (SPA build):** Uses `oven/bun:1` to install monorepo dependencies and run `vite build` on `packages/opencode-router-app/`. This produces the static SPA assets in `dist/`.
2. **Stage 2 (Router build):** Uses `node:22-alpine` to `npm ci` and `tsc` the router TypeScript.
3. **Stage 3 (Final):** Copies the compiled router (`dist/`), the built SPA (`public/`), and production-only `node_modules` into a minimal `node:22-alpine` image.

```bash
# Build from the monorepo root:
docker build -f packages/opencode-router/Dockerfile -t opencode-router:latest .
```

The build context must be the monorepo root (`.`) because stage 1 needs `packages/ui/` and `packages/opencode-router-app/` from the workspace.

Push to your registry:
```bash
docker tag opencode-router:latest <your-registry>/opencode-router:latest
docker push <your-registry>/opencode-router:latest
```

## What the Router Creates Dynamically

Understanding what the router creates at runtime is essential for capacity planning and debugging. The router creates these Kubernetes resources via the API — they are not defined in static manifests.

### Per-User PVCs

Created on first visit. **Never deleted by the router** — they persist across pod restarts and idle cleanup.

```
Name:          opencode-pvc-<hash>        # hash = sha256(email)[0:12]
Namespace:     opencode
AccessModes:   ReadWriteOnce
StorageClass:  <STORAGE_CLASS or cluster default>
Capacity:      <STORAGE_SIZE, default 2Gi>
Labels:
  opencode.ai/user-hash: <hash>
  app.kubernetes.io/managed-by: opencode-router
```

### Per-User Pods

Created when a user submits the setup form (or on first visit if `DEFAULT_GIT_REPO` is set). Deleted by the idle cleanup loop.

```
Name:          opencode-user-<hash>
Namespace:     opencode
Labels:
  opencode.ai/user-hash: <hash>
  app.kubernetes.io/managed-by: opencode-router
Annotations:
  opencode.ai/last-activity: <ISO 8601 timestamp>
  opencode.ai/user-email: <email>

Init containers (if git repo configured):
  git-init:
    image: alpine/git:latest
    command: if [ ! -d /workspace/.git ]; then git clone <repoUrl> /workspace; fi
    volumeMounts: user-data → /workspace (subPath: projects)

Containers:
  opencode:
    image: <OPENCODE_IMAGE>
    command: opencode serve --hostname :: --port 4096
    ports: 4096
    envFrom: secret/opencode-api-keys
    volumeMounts:
      user-data → /root
      opencode-config → /root/.opencode (readOnly)

Volumes:
  user-data:       PVC opencode-pvc-<hash>
  opencode-config: ConfigMap opencode-config-dir
```

**Important:** The Pods are bare Pods, not Deployments or StatefulSets. The router manages their lifecycle directly. If a Pod crashes (`restartPolicy: Always` handles container restarts), but if the node goes down, the Pod is gone and the router will recreate it on the next request. This is intentional — the PVC retains all state.

## Capacity Planning

| Resource | Per-User | Shared | Notes |
|---|---|---|---|
| Pod | 1 per active user | — | Deleted after idle timeout |
| PVC | 1 per user (ever) | — | Never auto-deleted, survives pod restarts |
| CPU/Memory | Per `opencode serve` | — | Size based on OpenCode workload |
| Storage | `STORAGE_SIZE` per user | — | Default 2Gi; holds sessions, history, workspace |
| Router replicas | — | 2+ recommended | Stateless, handles all users |

**Resource Quotas:** Consider setting a `ResourceQuota` on the namespace to cap the total number of Pods and PVC storage. The router does not enforce user limits — it will keep creating Pods until K8s rejects the API call.

**LimitRange:** Consider a `LimitRange` to set default resource requests/limits on user Pods. The router currently does not set resource requests/limits on user Pods — this is a known gap that should be addressed before production use.

## Network Policies (Optional)

If your cluster enforces NetworkPolicies, you need to allow:

1. **Ingress → oauth2-proxy → router:** Standard HTTP/HTTPS
2. **Router → user Pods (port 4096):** The proxy traffic
3. **Router → Kubernetes API server:** For pod/PVC management
4. **User Pods → Internet:** For OpenCode to reach LLM APIs (Anthropic, OpenAI, etc.)
5. **User Pods → git hosts:** For the git-init container to clone repos

## Operational Notes

### Monitoring

- **Router health:** The `/api/status` endpoint (with any email header) returns 200 if the router is running. Use it for readiness/liveness probes.
- **Active users:** `kubectl get pods -n opencode -l app.kubernetes.io/managed-by=opencode-router` lists all user Pods.
- **Idle timestamps:** `kubectl get pods -n opencode -o json | jq '.items[].metadata.annotations["opencode.ai/last-activity"]'` shows last activity per user.

### Manual PVC Cleanup

The router never deletes PVCs. To clean up storage for offboarded users:

```bash
# List all PVCs managed by the router
kubectl get pvc -n opencode -l app.kubernetes.io/managed-by=opencode-router

# Delete a specific user's PVC (make sure their pod is deleted first)
kubectl delete pvc opencode-pvc-<hash> -n opencode
```

### Forcing a User Pod Restart

```bash
# Delete the pod — the router will recreate it on the user's next request
kubectl delete pod opencode-user-<hash> -n opencode
```

The PVC is preserved, so the user's sessions and files survive.

### Updating the OpenCode Image

1. Push a new `OPENCODE_IMAGE` to your registry
2. Update the `OPENCODE_IMAGE` env var on the router Deployment (or keep `:latest` and update the image)
3. Existing user Pods continue running the old image until they are deleted (idle timeout or manual)
4. New Pods (from new users or after idle cleanup) get the new image

There is no rolling update of user Pods — they are recreated, not updated in place.

## Complete Deployment Checklist

1. [ ] Create the `opencode` namespace
2. [ ] Create the ServiceAccount, Role, and RoleBinding
3. [ ] Create the Secret with API keys
4. [ ] Create the ConfigMap with OpenCode configuration
5. [ ] Build and push the router Docker image
6. [ ] Ensure the OpenCode image is available to the cluster
7. [ ] Deploy oauth2-proxy (or your auth proxy) with `--set-xauthrequest=true`
8. [ ] Deploy the router Deployment and Service
9. [ ] Configure Ingress with auth middleware and WebSocket support
10. [ ] Set up DNS for your domain
11. [ ] Test: visit the domain, authenticate, see the repo selection UI, submit, wait for pod, use OpenCode
12. [ ] (Optional) Configure ResourceQuota and LimitRange on the namespace
13. [ ] (Optional) Configure NetworkPolicies
14. [ ] (Optional) Set up a CronJob or script for periodic PVC cleanup

## Local Development

To develop and test the router locally against a live cluster (without building and pushing a Docker image):

### 1. Generate a temporary kubeconfig

```bash
# Requires: kubectl pointing at the cluster, opencode-router SA already deployed
./scripts/create-local-kubeconfig.sh
```

This creates `/tmp/opencode-router-local.kubeconfig` using a short-lived ServiceAccount token (valid 24h by default).

### 2. Configure local environment

```bash
cp .env.local.example .env.local
# Edit .env.local if needed (defaults work for the homelab setup)
```

### 3. Build and start the router

```bash
bun run build          # compile TypeScript → dist/
npm run dev            # sources .env.local automatically, starts on PORT=3002
```

### 4. Start the SPA dev server (separate terminal)

```bash
cd ../opencode-router-app
bun run dev            # Vite runs on :5173 as a background HMR server
```

**Open `http://localhost:3002`** — the router is the single entry point:
- When no pod is running: router proxies the SPA from Vite (`DEV_VITE_URL=http://localhost:5173`), HMR works
- When pod is running: router proxies to the opencode pod via port-forward (`DEV_POD_PROXY_TARGET`)
- `window.location.replace("/")` in the SPA stays at `localhost:3002`, no redirect loop

### 5. Port-forward the user pod (when testing the running state)

```bash
./scripts/port-forward-pod.sh   # reads DEV_EMAIL from .env.local, computes pod name
```

This forwards `localhost:4096 → <pod>:4096`. Required because pod IPs are cluster-internal.

### Auth bypass in local dev

The router requires `X-Auth-Request-Email` header (set by oauth2-proxy in production). Locally, set `DEV_EMAIL` in `.env.local`:

```
export DEV_EMAIL=dev@local.test
```

When `DEV_EMAIL` is set and the header is absent, the router assumes that identity. **This env var is never set in production** — the 401 behavior for unauthenticated requests is preserved in all deployed environments.

### Dev environment variables summary

| Variable | Where | Purpose |
|---|---|---|
| `DEV_EMAIL` | router `.env.local` | Auth identity when oauth2-proxy header is absent |
| `DEV_VITE_URL` | router `.env.local` | Proxy setup UI to Vite dev server (enables HMR) |
| `DEV_POD_PROXY_TARGET` | router `.env.local` | Fixed proxy target for pod (bypasses unreachable pod IP) |
| `KUBECONFIG` | router `.env.local` | Temp kubeconfig with SA token for cluster access |
