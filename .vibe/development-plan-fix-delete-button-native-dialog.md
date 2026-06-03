# Development Plan: opencode-router (fix/delete-button-native-dialog branch)

*Generated on 2026-06-02 by Vibe Feature MCP*
*Workflow: [bugfix](https://codemcp.github.io/workflows/workflows/bugfix)*

## Goal
Remove all `@opencode-ai/ui` JS/TS component dependencies from `packages/app`. Replace with self-contained local UI components that look identical (same CSS design tokens). Fix the broken delete/terminate button dialog using native HTML `<dialog>` with `showModal()`.

## Key Decisions

1. **Root cause**: Kobalte's `Dialog` internally calls `disableBodyPointerEvents` which tries to set `document.body.style`, but this crashes (`TypeError: Cannot read properties of null (reading 'style')`) when the dialog is rendered via `DialogProvider.show()` — which stores and renders a JSX node outside a proper reactive context/portal.

2. **Fix strategy**: Replace the Kobalte-based `Dialog` component with a native HTML `<dialog>` element using `showModal()`. No Kobalte dependency needed. Use `<Portal>` from `solid-js/web` to render into body.

3. **DialogProvider bug**: The original `DialogProvider` stored `render()` output as a static node (`node: render()`). This meant SolidJS could not properly track reactivity and Portal cleanup didn't fire on unmount. Fixed by storing the render _function_ and calling it inside a `<Show>` block so it executes in a proper reactive context.

4. **Scope expanded**: User requested no more dependencies on `@opencode-ai/ui` JS components (not just Dialog). All components now live in `packages/app/src/ui/`:
   - `button.tsx` — native `<button>` with same `data-component` attributes
   - `dialog.tsx` — native `<dialog>` with `showModal()`
   - `text-field.tsx` — native `<input>` wrapper
   - `icon.tsx` — inline SVG icon component
   - `spinner.tsx` — pure SVG spinner
   - `context/i18n.tsx` — copy of I18n context (no external deps)
   - `context/dialog.tsx` — fixed DialogProvider (stores render fn, not node)
   - `context/index.ts` — re-exports

5. **CSS unchanged**: `index.css` still imports from `@opencode-ai/ui/styles` for design tokens (colors, theme, component CSS). This is intentional — CSS is the shared visual language.

6. **ThemeProvider removed**: Was a no-op passthrough (`return <>{props.children}</>`). Removed from `entry.tsx`.

7. **TypeScript clean**: `npx tsc --noEmit` passes with 0 errors.

8. **Dialog overlay `pointer-events` fix**: The CSS for `[data-component="dialog"]` sets `pointer-events: none` on the dialog element. The overlay div inside inherits this and clicks don't register. Fixed by adding `pointer-events: auto` explicitly to the overlay div inline style in `dialog.tsx`. Without this, overlay click-to-close didn't work.

9. **Terminate API uses DELETE, not POST**: `terminateSession(hash)` calls `DELETE /api/sessions/:hash` (not `/terminate`). Relevant when mocking for tests.

10. **Native `<dialog>` centering fix**: Browsers position `<dialog>` with their own UA stylesheet (typically `margin: auto` but not `position: fixed`). Our CSS rule `[data-component="dialog"] { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center }` was being overridden by the browser's default dialog styles. Fixed by explicitly applying `position: fixed; inset: 0; width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; margin: 0` as inline styles on the `<dialog>` element so the browser UA stylesheet cannot win.

11. **Optimistic session deletion**: On confirm in the terminate dialog, the session is removed from UI state immediately (before the API call resolves). `terminateSession(hash)` runs fire-and-forget in the background with `.catch()` for error logging. The `terminating: Set<string>` signal and prop were removed entirely — the session simply disappears from the list at click time, so no loading/spinner state is needed.

## Verify Results (2026-06-02)
- **TypeScript**: `tsc --noEmit` → 0 errors ✅
- **No `@opencode-ai/ui` JS imports**: `rg` finds none in `packages/app/src` ✅
- **Vitest**: 3 test files, 43 tests — all pass ✅
- **Settings dialog**: Opens ✅, closes via X button ✅, closes via Escape key ✅, closes via overlay click ✅ (after pointer-events fix), DOM clean after close (0 `<dialog>` elements) ✅, centered on screen ✅ (after inline position fix)
- **Terminate dialog**: Opens when Beenden clicked ✅, no Kobalte crash ✅, no console errors ✅, Cancel closes dialog cleanly ✅, Confirm calls `DELETE /api/sessions/:hash` and removes session from list ✅, centered on screen ✅
- **Console**: Only expected 401 (`/api/user/repos`) and 404 (favicon) — no `TypeError`, no Kobalte errors ✅

## Notes
- `packages/ui` (the `@opencode-ai/ui` workspace package) still exists and still exports components for any other consumers. We simply stopped using it in `packages/app`.
- The `button.css`, `dialog.css`, `text-field.css` etc. CSS files in `packages/ui/src/components/` are still imported via `@opencode-ai/ui/styles` — they use `data-component`/`data-slot` attribute selectors which match our new native components.
- Icon names expanded in local `icon.tsx` to include `arrow-up` and `arrow-left` (used by Button in session-input-bar and session-sidebar).

## Reproduce
<!-- beads-phase-id: opencode-router-2.1 -->
### Tasks
<!-- beads-synced: 2026-06-02 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

- [x] `opencode-router-2.1.1` Investigate delete button bug - Kobalte Dialog error in DialogProvider
- [ ] `opencode-router-2.1.2` Replace Kobalte Dialog with native HTML dialog element
- [ ] `opencode-router-2.1.3` Verify delete button works end-to-end in browser

## Analyze
<!-- beads-phase-id: opencode-router-2.2 -->
### Tasks
<!-- beads-synced: 2026-06-02 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*


## Fix
<!-- beads-phase-id: opencode-router-2.3 -->
### Tasks
<!-- beads-synced: 2026-06-02 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*


## Verify
<!-- beads-phase-id: opencode-router-2.4 -->
### Tasks
<!-- beads-synced: 2026-06-02 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

- [x] `opencode-router-2.4.1` TypeScript compile check (tsc --noEmit)
- [x] `opencode-router-2.4.2` Settings dialog: open, close via X button, Escape key, overlay click
- [x] `opencode-router-2.4.3` Terminate dialog: create session, open terminate dialog, confirm termination
- [x] `opencode-router-2.4.4` Verify no @opencode-ai/ui JS imports remain in packages/app/src
- [x] `opencode-router-2.4.5` Run vitest unit tests

## Finalize
<!-- beads-phase-id: opencode-router-2.5 -->
### Tasks
<!-- beads-synced: 2026-06-02 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

- [x] `opencode-router-2.5.1` Code cleanup: scan for debug console.log/TODO/FIXME in changed files
- [x] `opencode-router-2.5.2` Documentation review: check .vibe/docs/design.md and update if needed
- [x] `opencode-router-2.5.3` Final validation: re-run tsc --noEmit and npm test
