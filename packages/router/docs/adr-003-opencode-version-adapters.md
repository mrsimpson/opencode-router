# ADR-003: Version Adapters for the opencode Server API

**Status:** Proposed  
**Date:** 2026-09-26

## Context

The router talks to the opencode server inside each session pod, and it does so at several points:

| Touchpoint | Where | Purpose |
|---|---|---|
| List the newest root session | `podActivityMs` | Idle detection, resume deep link |
| Create a session | `bootstrapPodSession` | First session on a fresh pod |
| Send the initial prompt | `bootstrapPodSession` | Kick off the user's task |
| Web UI deep link | `deepLinkUrl` | URL the SPA redirects the user to |
| Export a session as JSON | `archive.ts` (exec in the pod) | Archive before PVC deletion |
| In-pod plugin | `packages/plugin` | Push titles/messages/ports to the router |

opencode now ships two incompatible release lines (verified against the `v1.18.32` binary and the `v2.0.18` source):

| | 1.x (npm `latest`, `dev` branch) | 2.0 (`v2.0.x` tags) |
|---|---|---|
| Legacy routes (`/session`, `/session/{id}/prompt_async`) | ✅ | ❌ removed; the server registers only `/api/*` |
| `/api/session` list/create, `/api/session/{id}/prompt` | ✅ since ~1.18 (preview) | ✅ |
| Version endpoint | `GET /global/health` → `{ healthy, version }`; `/api/info` is answered by the SPA catch-all (HTML, 200) | `GET /api/info` → `{ version, … }` |
| Web UI deep link | `/<b64(dir)>/session/<id>` (1.18 also accepts the 2.0 form) | `/server/<b64url(serverUrl)>/session/<id>` |
| Export CLI | `opencode export <id>` | `opencode session export <id> --server <url>` or `--standalone` |
| Plugin API | `@opencode-ai/plugin` hooks | `@opencode/plugin` `{ id, setup(context) }` |

The opencode image is operator-supplied (`OPENCODE_IMAGE`), so the router can't know the version at build time. Two pods in the same cluster may even run different versions during an image rollout.

## Decision

Everything version-specific moves behind an **`OpencodeAdapter`** interface in `packages/router/src/opencode/`, with one implementation per release line:

```ts
interface OpencodeAdapter {
  readonly generation: "v1" | "v2"
  latestRootSession(base, fetch): Promise<{ id?: string; updatedMs: number } | null>
  createSession(base, fetch): Promise<string | null>
  sendPrompt(base, sessionId, text, fetch): Promise<boolean>
  deepLink(podUrl, sessionId): string
  exportCommand(sessionId, mode: "running" | "stopped"): string[]
}
```

- **`v1`** keeps today's behaviour byte for byte: legacy routes, the `/<b64(dir)>/session/<id>` link and `opencode export`.
- **`v2`** uses `/api/session*`, the `/server/<b64url>/session/<id>` link, and `opencode session export` with `--server http://localhost:<port>` for a running pod or `--standalone` for the temporary export pod.

### Selecting an adapter

1. **`OPENCODE_API=v1|v2`** pins the adapter and skips detection. This is the escape hatch if detection misfires.
2. **`OPENCODE_API=auto`** (default) probes `GET <pod>/api/info` once per pod:
   - A JSON body with a string `version` means **v2**. Only 2.x has this endpoint, and dev snapshots report versions like `0.0.0-dev-…`, so the major version isn't reliable.
   - Any other response, including 1.x's HTML catch-all or a 404, means **v1**.
   - A network error means the pod isn't ready. Nothing is cached and the next poll retries.
3. The result is cached per session hash and pod base URL. A new pod (new IP) is probed again.
4. The detected generation is persisted as the PVC annotation `opencode.ai/opencode-api`, so archiving a *stopped* session (no server to probe) runs the right export command. If the annotation is missing, the export uses the pinned `OPENCODE_API` if set, otherwise `v1`.

### Why not switch everything to `/api/*`?

1.18 already serves the new session API, so one HTTP code path could cover 1.18+ and 2.0. We still keep a separate v1 adapter because:

- Older 1.x builds, including the dev snapshots homelab-apps currently pins (`0.0.0-dev-202604140703`), predate the `/api` preview.
- The deep link and export command differ by release line anyway, so there is a version switch either way. Keeping the whole contract per adapter keeps each variant coherent and testable.
- The preview's contract was still being audited upstream (`V2_HTTP_API_AUDIT.md`); pinning 1.x to the routes it has always used avoids surprises.

Once 1.x is no longer supported, the v1 adapter can be deleted in one step.

## Consequences

- The call sites in `pod-manager.ts` and `archive.ts` no longer contain URLs, payload shapes or CLI flags; they only call the adapter.
- Supporting a future 3.x means adding one adapter plus a detection rule.
- One extra request per pod lifetime (the probe).
- The temporary export pod for a *stopped* session runs the current `OPENCODE_IMAGE`, while the PVC annotation records the generation of the last pod that ran. If the image moves from 1.x to 2.x in between, the export command won't match the CLI. Pin `OPENCODE_API` during such a switch. Opening a 1.x PVC with 2.x relies on opencode's own v1 data migration, which is outside the router's control.
- **Not covered by this ADR: the in-pod plugin.** 2.0 replaced the plugin API (`@opencode/plugin`, `Plugin = { id, setup(context) }` with `context.event.subscribe` and `context.session`). The router plugin needs a second entry point for 2.0, and the pod image (built in homelab-apps) must load the matching one. Until then, on 2.0 pods, session titles/messages and port discovery pushed by the plugin are unavailable. Session creation, the initial prompt, idle detection, deep links and archiving work through the adapter.

## Verification

- v1 adapter: contract tests, plus an opt-in integration test against a real 1.x server (`OPENCODE_BIN=/path/to/opencode pnpm --filter ./packages/router test`), run against 1.18.32.
- v2 adapter: contract tests built from the 2.0 protocol (`packages/protocol/openapi.json` at `v2.0.18`). The same integration test exercises its HTTP calls against 1.18's `/api` preview, which serves the same routes and shapes. The deep link format and export CLI flags were checked against the 2.0 source (`packages/app/src/shell/routes/session.ts`, `packages/cli/src/commands/commands.ts`) and **still need a check on a real 2.0 pod**.
