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
- [x] Commit the changes (`f911b42`)

### Completed
*All Finalize tasks completed*

## Frontend Investigation (Autocomplete still fails after backend fix)

### Complete Flow: User Input to Displaying Suggestions

```
User types in repo URL input
  └─> Autocomplete.onInput (packages/app/src/autocomplete.tsx:92-98)
       │
       │  Calls props.onSelect(v) with raw text input on EVERY keystroke
       │  Opens dropdown if items exist and input is non-empty
       │
       ▼
  SessionInputBar.onSelect handler (packages/app/src/session-input-bar.tsx:178-181)
       │
       │  Calls props.onRepoUrlChange(v) → sets repoUrl state
       │  Calls loadBranchesForRepo(v) → fetches branches for the typed text
       │
       ▼
  Autocomplete dropdown (packages/app/src/autocomplete.tsx:120-170)
       │
       │  Filters repoItems by matching query against item.label (repo name only)
       │  Displays matching repos in dropdown
       │
       ▼
  User selects a repo from dropdown (packages/app/src/autocomplete.tsx:159)
       │
       │  Calls handleSelect(item.value) → props.onSelect(item.value)
       │  item.value = the repo URL (e.g. "https://github.com/org/repo")
       │
       ▼
  SessionInputBar.onSelect handler again (same as step 2)
       │
       │  Calls props.onRepoUrlChange(url) → sets repoUrl state
       │  Calls loadBranchesForRepo(url) → fetches branches for selected repo
       │
       ▼
  loadBranchesForRepo (packages/app/src/session-input-bar.tsx:94-110)
       │
       │  Looks up repo in userRepos by URL (findRepoByUrl)
       │  Sets defaultBranch on sourceBranch input
       │  Calls listRepoBranches(fullName) → GET /api/user/repos/branches?repo=org/repo
       │
       ▼
  Frontend API (packages/app/src/api.ts:226-231)
       │
       │  GET /api/user/repos/branches?repo=org/repo
       │
       ▼
  Backend Router (packages/router/src/api.ts:606-642)
       │
       │  Calls GitHub API: GET /repos/{repo}/branches?per_page=100
       │  Returns { name: string }[]
```

### API Endpoints Used

| Frontend Function | Endpoint | Backend Handler |
|---|---|---|
| `listUserRepos()` | `GET /api/user/repos` | `packages/router/src/api.ts:528-604` |
| `listRepoBranches(repo)` | `GET /api/user/repos/branches?repo=...` | `packages/router/src/api.ts:606-642` |

### Key Files and Line Numbers

| File | Lines | Purpose |
|---|---|---|
| `packages/app/src/autocomplete.tsx` | 1-173 | Generic autocomplete dropdown component |
| `packages/app/src/autocomplete.tsx` | 27-31 | `filteredItems()` - filters by `label` field |
| `packages/app/src/autocomplete.tsx` | 92-98 | `onInput` - calls `onSelect(v)` on every keystroke |
| `packages/app/src/autocomplete.tsx` | 120 | Dropdown visibility condition |
| `packages/app/src/autocomplete.tsx` | 148-168 | `For each={filteredItems()}` - renders dropdown items |
| `packages/app/src/session-input-bar.tsx` | 28-40 | `loadUserRepos()` - lazy loads from API |
| `packages/app/src/session-input-bar.tsx` | 80-91 | `ensureReposLoaded()` - maps Repo[] to {label, value} |
| `packages/app/src/session-input-bar.tsx` | 94-110 | `loadBranchesForRepo()` - loads branches on selection |
| `packages/app/src/session-input-bar.tsx` | 175-184 | Repo URL Autocomplete usage |
| `packages/app/src/session-input-bar.tsx` | 185-190 | Branch Autocomplete usage |
| `packages/app/src/api.ts` | 208-214 | `Repo` interface definition |
| `packages/app/src/api.ts` | 220-224 | `listUserRepos()` - calls `GET /api/user/repos` |
| `packages/app/src/api.ts` | 226-231 | `listRepoBranches()` - calls `GET /api/user/repos/branches` |
| `packages/router/src/api.ts` | 528-604 | `GET /api/user/repos` handler (with type=all, pagination, dedup) |
| `packages/router/src/api.ts` | 606-642 | `GET /api/user/repos/branches` handler |

### BUG FOUND: `onSelect` is misused as both value setter and action trigger

**Location**: `packages/app/src/autocomplete.tsx` line 94 and `packages/app/src/session-input-bar.tsx` lines 178-181

**Problem**: The `Autocomplete` component calls `props.onSelect(v)` in its `onInput` handler (line 94) on every keystroke. The `session-input-bar.tsx` handler uses `onSelect` for two purposes:
1. Setting the repo URL state (`props.onRepoUrlChange(v)`)
2. Triggering branch loading (`loadBranchesForRepo(v)`)

When the user types "my", the handler receives the raw text "my" (not a URL), and `loadBranchesForRepo("my")` is called. This:
- Tries to parse "my" as a URL (strips protocol, removes `.git`)
- Splits by "/" and gets only 1 part
- The `repoParts.length >= 2` check prevents the API call, but the side effect is still triggered

**Impact**: Every keystroke triggers unnecessary processing. While the guard in `loadBranchesForRepo` prevents crashes, the pattern is fragile and the autocomplete behavior is inconsistent.

**Root cause of autocomplete "failing"**: The `onInput` handler calls `props.onSelect(v)` with the raw input text. The `Autocomplete` component's `onSelect` prop is semantically meant for "user selected an item" but is being used as "value changed". This conflates two different events.

### Fix Required

The `Autocomplete` component needs a separate `onInput` callback to decouple typing from item selection:

```tsx
// In autocomplete.tsx, replace:
onInput={(e) => {
  const v = e.currentTarget.value
  props.onSelect(v)  // <-- WRONG: triggers action on every keystroke
  ...
}}

// With:
onInput={(e) => {
  const v = e.currentTarget.value
  props.onInput?.(v)  // <-- NEW: separate callback for typing
  ...
}}
```

Then in `session-input-bar.tsx`:
```tsx
<Autocomplete
  onSelect={(url) => {
    props.onRepoUrlChange(url)
    loadBranchesForRepo(url)  // Only called on actual selection
  }}
  onInput={(text) => {
    props.onRepoUrlChange(text)  // Only updates state, no side effects
  }}
  items={repoItems()}
  loading={reposLoading()}
/>
```

### Additional Observation: Filtering by label only

The `Autocomplete` component filters items by matching the query against `item.label` only (line 30 of `autocomplete.tsx`). For repos, `label` is just the repo name (e.g., "my-repo"), not the full path (e.g., "org/my-repo"). Users who type "org/my" will not see matches because the org name is not in the label. This is a UX limitation but not a bug -- the dropdown shows all repos when no query is entered, and org repos are included in the list.

---
*This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what section to work on.*
