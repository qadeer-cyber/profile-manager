# M2 backend handoff

Status: **WIP / UNVERIFIED**. A pushed SHA is not acceptance, integration, or release approval.

## Remote

- Repository: `qadeer-cyber/profile-manager`
- Branch: `feature/m2-diagnostics-backend`
- Sole backend writer: `bc-ac164b2e`
- Baseline: `d7a000eeadd4f4645a608a1e0cc2b8ad154a75d9`
- Source checkpoint (pushed): `aa052d900ecbb0da120e5c06b33c6ced3b262a06`
- Handoff commit already pushed: `90193f6477de3e29f19ce19f31623ea2e19864b9`
- Fetch `origin/feature/m2-diagnostics-backend` for the tip. A later commit on this file only records that SHA.
- Contract: DiagnosticsV1, SHA-256 `cd1ce49f379566efa0fa65ed81f5402f21259191cbdb6aa6088eb8413b8059d8`
- Directive read: `MASTER_DIRECTIVE.md` at `ecf4aedb54e672ccc3b13456875b176aeccf7bf8`

## Files on this branch

- `server/diagnostics.js` — DiagnosticsV1 collection, per-operation observation state, routes, contract error envelope
- `server/browsers.js` — read-only pipe/proxy/WebRTC adapter; launch entry gains `launchSnapshot` only
- `server/app.js` — profile diagnostic routes mounted before `/api`, diagnostic-path error shape only
- `test/diagnostics-unit.test.js` — unit and HTTP coverage, including each observation state for GET and POST

No migrations, no UI files, no M1 lifecycle/classifier/cleanup edits.

## Completed in source

- `GET /api/profiles/:id/diagnostics` and `POST /api/profiles/:id/diagnostics/environment`
- POST body is the full DiagnosticsV1 object. The section 7 disclosure sentence is not an API field.
- Confirmed observation state: complete / partial / unavailable / invalidated, judged only on facts required by that operation
- Desktop `X-UI-Token`; non-desktop Bearer or `X-API-Key`; auth before profile lookup; existence is `SELECT id`
- `Cache-Control: no-store` on diagnostic success and error
- One visible data-URL tab on POST, never auto-closed; GET opens no page
- 3s deadline, one collection per profile, 429 on overlap, 30s `validUntil` for partial and complete

## Partial / pending confirmation

- WebRTC command line via `Browser.getBrowserCommandLine` on the existing pipe. Raw argv stays in the adapter.
- `effectivePolicy` is always unavailable, reason `unsupported`.
- GET environment facts are `permission_required` and do not block GET completion.
- `expectedLaunchId` is an opaque exact match. Published launch ids are 1–128 visible ASCII.
- Initial launch mismatch is HTTP 409. A later launch change is HTTP 200 `invalidated`.
- Error sentences other than the exact `DIAGNOSTICS_BUSY` sentence restate the contract.
- A timeout drops in-flight browser facts. GET can still be partial because the manifest remains.

## Tests

```text
node --test test/diagnostics-unit.test.js
24 pass, 0 fail

npm run test:unit
94 pass, 1 fail
Fail: installed playwright-core 1.64.1 exposes the launched browser child
Cause: Chromium executable absent (chromium_headless_shell-1248). The test launches Playwright directly.

node --test test/termination-evidence.test.js test/desktop-unit.test.js
21 pass, 0 fail
```

Not run: `test/lifecycle.e2e.js`, engine e2e, UI smoke (`web/dist` absent), Windows push CI, installed EXE.

## Known gaps

- Real `Browser.getBrowserCommandLine` on Chromium 156.0.8078.4 was not executed.
- Live lifecycle (user tab close, last window, App Stop, taskkill, rapid relaunch) was not executed.
- Headless profiles cannot be literally visible. `bringToFront` is still called.
- A protocol call that never settles after detach keeps that profile's diagnostic guard until it settles.

## Security

Unit tests use the fixture prefix `sentinel9f3a7c2e`. No customer database, profile directory, cookie export, or real token is in the commit. Diagnostic reads do not decrypt proxy passwords. Passwords, usernames, relay URLs, and raw command lines are not copied into the DiagnosticsV1 payload by the unit cases.

No security blocker inside the authorized diff. Real-browser confirmation is still open.

## Next exact step

Install pinned Chromium and run `node --test test/lifecycle.e2e.js` plus the diagnostics unit file against that browser. Do not start M3, M4, or M5.

## Outstanding approvals

- Pending working defaults listed above
- No merge, no PR, no installer dispatch, no tag, no release
