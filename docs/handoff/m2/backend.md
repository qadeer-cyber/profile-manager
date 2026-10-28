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

## Codex recovery checkpoint — 2026-10-19 (WIP; not accepted)

Owner transferred single-writer ownership after Grok stopped. Original upstream
checkpoint: 32f90895e7ee9f3ac2b60f2337e8604d9c3117d8. All M1 assertions preserved.

Contracts are preserved under `contracts/` with SHA256SUMS. The amended file adds
only `process_command_line` to Source. Original SHA: cd1ce49f379566efa0fa65ed81f5402f21259191cbdb6aa6088eb8413b8059d8.
Amended SHA: e80ce2d513e610a18c703b775fb0fd5520e3eb1ca5dce6f4ad43a1eecf08bdf4.
Owner's state/timeout/auth decisions supplement the original prose; no new fields,
per-fact timestamps, policy cache, migrations, or Chromium flags were added.

Changes: bounded Linux /proc and Windows CIM process observation; identity pinned
to launchId, launched-child PID and OS process start; allowlisted summary only;
Chromium switch syntax; manifest-only unavailable; null invalidated launchId;
all diagnostic sessions detached at deadline; dedicated page CDP evaluation;
headless rejection; visibility, exact data URL and navigation checks; route/listener
cleanup; diagnostics auth before JSON parsing; trailing slash error envelopes;
diagnostics included in test:unit.

Chromium source references used for parsing (read-only):
- https://chromium.googlesource.com/chromium/src/+/main/base/command_line.cc
- https://chromium.googlesource.com/chromium/src/+/0b49fa16f0265a0b1274383546fe933c288d2106/content/public/common/content_switches.cc
The recognized name is force-webrtc-ip-handling-policy. Separated values are not
switch values. Windows prefixes/case differ from POSIX. '--' stops switches.

Actual local evidence: Node 24.19.0, macOS 13 x64. Diagnostics unit + OS helper:
37 pass / 0 fail / 1 skip / 0 todo (skip is real Linux/Windows OS observation).
Combined unit snapshot before the final four regressions: 127 pass / 1 fail /
1 skip / 0 todo; unchanged M1 real-browser-child test fails because pinned
Chromium is absent. Playwright install chromium refuses mac13 as unsupported.
No host-platform override or installation restriction bypass was attempted.

Limitations: actual Windows process/CIM, quoting, process reuse and timing are
UNVERIFIED. Linux /proc behavior is UNVERIFIED on a real Linux host. macOS argv
is fail-closed (collection_failed), since ps cannot guarantee original boundaries.
Pinned Chromium 156.0.8078.4 and real evaluation detach require a supported host.
No independent review or milestone acceptance is claimed. Remaining suite results
will be recorded in the integration packet. No Windows CI or installer dispatched.

Final local review follow-up: Windows OS subprocess cancellation now waits for the
child close event (an AbortError alone is not termination acknowledgement), and
Linux proc reads receive the cancellation signal. Rechecked process unit suite:
3 pass / 0 fail / 1 skip / 0 todo; syntax and diff checks pass. Actual platform
termination/timing behavior is still unverified. No original contract bytes changed.
