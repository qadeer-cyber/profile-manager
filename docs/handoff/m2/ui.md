# M2 Diagnostics UI — handoff (WIP / UNVERIFIED against real backend)

- **Owner:** Grok UI/UX Engineer
- **Branch:** `feature/m2-diagnostics-ui` (created from frozen M1 `d7a000eeadd4f4645a608a1e0cc2b8ad154a75d9`)
- **Remote SHA:** see `git log` on the branch (recorded in the room report)
- **Contract:** `DIAGNOSTICS_CONTRACT.md` v1, SHA-256 `cd1ce49f379566efa0fa65ed81f5402f21259191cbdb6aa6088eb8413b8059d8`
- **Evidence level:** 1 (mocked API only). Built against contract sections 1–6; sections 7–12 not yet reconciled.

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
- Open owner decisions: WebRTC 4-value allowlist into contract text (v1.1); meaning of `complete` (exclude effectivePolicy/iceCollection); GET tz/lang reason `permission_required`; effectivePolicy reason `unsupported`.

## Next exact step
Reconcile UI against contract sections 7–12 (timeouts/freshness, security/privacy, QA acceptance), then rerun `web/e2e/diagnostics-ui.mjs` against the real `feature/m2-diagnostics-backend` routes with a real browser.

## Outstanding approvals
- `api.js` error-body fix (ownership exception).
- Integration, merge and installer dispatch: not authorized.
