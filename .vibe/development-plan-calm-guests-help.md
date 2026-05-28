# Development Plan: repo (fix/repository-dropdown-organizations branch)

*Generated on 2026-05-28 by Vibe Feature MCP*
*Workflow: [bugfix](https://codemcp.github.io/workflows/workflows/bugfix)*

## Goal
Fix the repository drop-down in the frontend so it lists repositories from organizations the user is a member of, not just personal repositories.

## Key Decisions
* The fix will be in the backend (router) API handler since that's where the GitHub API call is made.
* We will explicitly set `type=all` in the GitHub API query and implement pagination to fetch all repositories.

## Notes
- The repository dropdown is rendered by `SessionInputBar` component (`packages/app/src/session-input-bar.tsx`)
- It calls `loadUserRepos()` which fetches from `GET /api/user/repos`
- The router handler at `packages/router/src/api.ts` line 535 calls GitHub's `/user/repos` endpoint
- The GitHub API call currently uses: `https://api.github.com/user/repos?per_page=100&sort=updated`
- No `type` parameter is specified, and pagination is not handled

## Reproduce
### Tasks
- [x] Investigated the codebase to find the repository dropdown and API layer
- [x] Identified the root cause in the GitHub API call
- [x] Documented reproduction steps

### Completed
- [x] Created development plan file
- [x] Reproduced the issue: The GitHub API call at `packages/router/src/api.ts` line 535 fetches `https://api.github.com/user/repos?per_page=100&sort=updated` without the `type=all` parameter, and does not handle pagination

### Reproduction Steps
1. Authenticate with GitHub via the router (set `githubToken`)
2. Open the frontend and navigate to the session input bar
3. Click on the repository dropdown
4. Observe that only personal repositories are listed (or only a subset due to pagination)

### Root Cause
The GitHub API call at `packages/router/src/api.ts` line 535:
```
https://api.github.com/user/repos?per_page=100&sort=updated
```

Issues identified:
1. **Missing `type=all` parameter**: While the default for `/user/repos` is `type=all`, being explicit ensures all repository types (owner, member, public) are included.
2. **No pagination**: Only 100 repos are fetched per page. Users with more than 100 repos (personal + organization combined) will have repos truncated.
3. **No deduplication**: When `type=all`, the same repo can appear under multiple categories (e.g., a public repo owned by the user also appears in the public list).

### Affected Users
All users who are members of GitHub organizations with repositories that should appear in the dropdown.

### Business Impact
Users cannot select organization repositories from the dropdown, forcing them to manually type the full URL.

## Analyze
### Tasks
- [x] Root cause: GitHub API call at `/api/user/repos` handler does not explicitly set `type=all` and does not handle pagination

### Completed
*None yet*

## Fix
### Tasks
- [x] Add `type=all` parameter to the GitHub API call to explicitly include organization repositories
- [x] Implement pagination to fetch all repositories across multiple pages (by parsing `Link` header)
- [x] Deduplicate repositories (same repo can appear under multiple types, using `Map` keyed by `full_name`)
- [x] Update tests to verify the fix (added 3 new tests: pagination/dedup, type=all query, updated existing mock)

### Completed
*All Fix tasks completed*

## Verify
### Tasks
- [x] Run existing tests to ensure no regressions (216 tests, all passing)
- [x] Verify the fix with the test suite

### Completed
*All Verify tasks completed*

## Finalize
### Tasks
- [x] **Code Cleanup**: Verified no debug output, TODOs, or FIXMEs in changed files
- [x] **Documentation Review**: No `/home/opencode/repo/.vibe/docs/design.md` exists — no docs to update
- [x] **Final Validation**: All 216 tests pass via `vitest run src/`
- [x] Commit the changes (`28a7656`)

### Completed
*All Finalize tasks completed*



---
*This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on.*
