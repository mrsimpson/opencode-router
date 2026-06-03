# Development Plan: repo (fix/list-org-repos-autocomplete branch)

*Generated on 2026-06-03 by Vibe Feature MCP*
*Workflow: [epcc](https://codemcp.github.io/workflows/workflows/epcc)*

## Goal
*Define what you're building or fixing - this will be updated as requirements are gathered*
## Key Decisions
- Use `GET /user/orgs` to list all organizations the user belongs to, then `GET /orgs/{org}/repos` for each org's repos
- Merge personal repos and org repos using a Map keyed by `full_name` for deduplication
- Personal repos take precedence over org repos (org repos only added if not already present)
- Keep the existing pagination logic for personal repos; apply the same pagination approach for org repos
- If the `/user/orgs` API call fails, still return personal repos (graceful degradation)
- If a specific org's repo list fails, skip that org and continue with others
- If the personal repos API returns an error status (e.g. 403), propagate that status code to the client
- Extracted pagination logic into a reusable `paginateRepos` helper function that returns `{ repos, status }`

## Notes
- The fix is entirely in the router (`packages/router/src/api.ts`) — no client-side changes needed
- The `getRepoBranches` endpoint (`/api/user/repos/branches`) already works with org repos since it takes a `repo` parameter that can be any repo full name
- All existing tests pass (247 tests)
- 6 new tests added for org repos functionality

## Explore
### Tasks
- [ ] *Tasks will be added as they are identified*

### Completed
- [x] Created development plan file

## Plan
### Tasks
- [x] Modify `GET /api/user/repos` in `packages/router/src/api.ts` to also fetch org repos
  - Fetch user's personal repos via `GET /user/repos` (existing)
  - Fetch user's organizations via `GET /user/orgs`
  - For each org, fetch repos via `GET /orgs/{org}/repos`
  - Merge and deduplicate all repos by `full_name`
- [x] Add unit tests for org repos fetching in `packages/router/src/api.test.ts`
  - [x] Test that org repos are included in the response
  - [x] Test deduplication when a repo appears in both personal and org lists
  - [x] Test graceful handling when user has no orgs
  - [x] Test graceful handling when org API fails

### Completed
- All code changes implemented
- All 247 tests passing

## Code
### Tasks
- [ ] *To be added when this phase becomes active*

### Completed
*None yet*

## Commit
### Tasks
- [ ] *To be added when this phase becomes active*

### Completed
*None yet*



---
*This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on.*
