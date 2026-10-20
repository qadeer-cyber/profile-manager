# M2 Diagnostics UI — handoff (WIP / UNVERIFIED against real backend)

- **Owner:** Grok UI/UX Engineer
- **Branch:** `feature/m2-diagnostics-ui` (created from frozen M1 `d7a000eeadd4f4645a608a1e0cc2b8ad154a75d9`)
- **Remote SHA:** see `git log` on the branch (recorded in the room report)
- **Contract:** `DIAGNOSTICS_CONTRACT.md` v1, SHA-256 `cd1ce49f379566efa0fa65ed81f5402f21259191cbdb6aa6088eb8413b8059d8`
- **Evidence level:** 2 (real backend `32f9089` + real pinned Chromium 156.0.8078.4 on Linux, combined tree from `d7a000e`). Not Windows, Electron or installed EXE. Reconciled against contract §1–12 and the owner's completeness decision.

## Files changed (UI-owned only)
- `web/src/pages/DiagnosticsPage.jsx` (mounts the new component; +3/−1)
- `web/src/components/ProfileDiagnostics.jsx` (new)
- `web/src/hooks/useProfileDiagnostics.js` (new: request state, DiagnosticsV1 validation)
- `web/src/diagnostics.css` (new)
- `web/e2e/diagnostics-ui.mjs` (new: mocked-route e2e)

No changes to App.jsx, shared navigation, backend, `web/src/api.js`, package.json or lockfile.

## Done
- "Refresh observation" = GET `/api/profiles/:id/diagnostics`; "Observe timezone and language" = POST `/api/profiles/:id/diagnostics/environment` with `{expectedLaunchId, consent:"open-visible-diagnostic-tab"}`, sent only after the disclosure dialog is confirmed.
- Explicit refresh only (no polling); in-flight requests disable duplicates; superseded responses dropped (sequence counter).
- Strict DiagnosticsV1 response validation; malformed responses shown as an error, not rendered.
- Plain-text rendering only. Handles 401/404/409/429/500 by HTTP status.
- States complete / partial / unavailable / invalidated rendered exactly as returned by the server (UI never derives them).
- Environment facts shown as current only when their `observation.launchId` equals the latest GET's `launchId`.
- Never calls `/api/api-token`; never closes, inspects or navigates any tab.
- Accessibility: focus-trapped disclosure dialog, aria-live status region, role=alert errors, 700px and 200% zoom layouts.

## Tests (local box, Node 22.12.0; better-sqlite3 temporarily 9.6.0 because 13.0.3 fails on Linux box — not in diff)
- `node web/e2e/diagnostics-ui.mjs` — 47 pass, 0 fail (mocked routes)
- `npm run test:unit` — 95 pass, 0 fail (unchanged from baseline)
- `npm run test:ui` — 25 pass, 0 fail
- Mutation check: removing in-flight guard + superseded drop fails 18 e2e steps.

## Known issues / blockers
- `web/src/api.js` turns the contract error body `{error:{code,message,requestId}}` into "[object Object]" and drops `code`/`requestId`; UI maps by HTTP status. One-line fix needs owner's ownership exception.
- Real backend not integrated; no live-browser run yet. No Windows run yet.
- No axe audit or NVDA/Narrator pass.
- Web mode opens one extra EventSource.
- Owner decided `complete` semantics (per-operation required facts). Pending owner decisions that affect UI: new Source value (e.g. `process_command_line`) for B1 — UI validator must add it; F3 (stopped profile `partial` vs `unavailable`) — UI renders either.
- Backend B1 (real Chromium): commandLinePolicy always `unsupported`, so running GET is always `partial`.

## Checkpoint 2 (fix1)
- Transient errors (429/500/network) on Refresh keep the previous observation and POST result; Refresh disabled while the environment POST is in flight.
- Web mode (no desktop UI token): shows "Profile diagnostics are available in the Profile Manager desktop app.", both actions disabled, zero diagnostics requests.
- Tests: mock e2e 54/0; test:unit 95/0; test:ui 25/0; real backend + real Chromium (level 2, Linux) 29/0 (UI token) and 9/0 (web mode); mutation check 5 new steps fail when fixes reverted.

## Next exact step
After the owner's B1/source decision, add the approved Source value to `SOURCES` in `useProfileDiagnostics.js` with a plain label, rerun mock e2e and the real-backend run against the fixed backend commit. Read MASTER_DIRECTIVE.md from branch `docs/master-directive-handoff`.

## Outstanding approvals
- `api.js` error-body fix (ownership exception).
- Integration, merge and installer dispatch: not authorized.

## Codex recovery — 2026-10-19 (WIP, not M2 acceptance)

Original UI checkpoint 204152cbd1b9e670b13c674c84ff77520be774a7 preserved.
Backend amendment is versioned at backend commit 9f375ef8d2b398e18e920f6477846a606f29d44a,
`docs/handoff/m2/contracts/DiagnosticsV1.process-command-line.md`, SHA-256
e80ce2d513e610a18c703b775fb0fd5520e3eb1ca5dce6f4ad43a1eecf08bdf4.
UI now accepts process_command_line with the label Browser process observation.
Recognized policy values remain allowlisted. The approved api.js exception retains
safe error.code, error.message and error.requestId for diagnostics URLs only.
Ordinary error handling, auth, headers, token retrieval and request transport are
unchanged. Browser e2e fixtures now exercise process_command_line.

Actual evidence (Node 24.19.0, macOS 13 x64):
- node --test web/e2e/diagnostics-client.test.mjs: 4 pass / 0 fail / 0 skip / 0 todo.
- Vite production build: success (33 modules).
- Real pinned Chromium UI e2e: blocked; Playwright refuses mac13 as unsupported.
No Windows or installed-app evidence. No acceptance, PR, merge or installer run.
