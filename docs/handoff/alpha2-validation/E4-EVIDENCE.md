# M2 E4 evidence — Linux integrated tree

Status: **CLOSED on Linux**. This is not a Windows pass.

E4 is the merge-gate row from `docs/handoff/m2/t48-todo-classification.md`: no profile-diagnostics polling for 60 seconds, and no observation cache after a process restart. Stale `.pm-lock` cleanup and the auth/error contract were run in the same gate.

## Commands

Node v22.23.4. Host `linux 6.12.94+`. Chrome for the idle window: `/usr/bin/google-chrome-stable`. Pinned Chromium for the live suites: Playwright revision 1248, `156.0.8078.4`, SHA-256 `43fd31766c7533a02dda2ded5ad50c2f861cd5400be7509c0abad71129f79d79`.

```text
node --test --test-timeout=180000 test/diagnostics-e4-merge-gate.test.js
```

| Test | Result | Duration |
|---|---|---|
| E4 static: no poll, no diagnostics table | pass | <1 s |
| E4 restart: cache, stale lock, auth | pass | 811 ms |
| E4 idle: 60 s with a profile selected | pass | 64566 ms |

Machine-readable copies: `evidence/e4-idle.json`, `evidence/e4-restart.json`.

## What the idle run showed

- Wall clock of the idle window: 60000 ms (`e4-idle.json` `elapsedMs`).
- Profile diagnostics requests (`/api/profiles/:id/diagnostics` and `/environment`): **0**, including after a reload and reselection.
- The page stayed alive: 30 `GET /api/diagnostics`, 30 `GET /api/browser`, 12 `GET /api/meta`. Those are the existing app-health and meta timers. They do not collect a browser observation.
- `localStorage` and `sessionStorage` did not hold an observation.

## What the restart run showed

- Missing token, unknown id without a token, and `?token=` all returned **401** `UNAUTHORIZED` with `Cache-Control: no-store`. Auth ran before profile lookup.
- Bad id **400**. Missing profile **404**. Bad consent body **400**.
- First GET and the GET after a clean process restart returned different observation ids (`2aa262a6-d9b3-427b-a469-36e4bf0e2bd6`, then `99d0054a-aee7-4b2a-8186-8efb64f1fe64`). Both were `unavailable` / `not_running` with a null launch id.
- A planted file `diagnostics-observation-cache.json` (observation id `11111111-1111-4111-8111-111111111111`, chromium value `planted`) was not served and was not deleted.
- GET did not create a new file in the data directory.
- SQLite had no diagnostics table.
- After a dead running row (pid 4194303) and two dead `.pm-lock` files were planted, startup logged `Recovery: cleared 1 running record(s), 1 stale lock(s), killed 0 orphaned browser(s)`. Both locks were gone and the running table was empty.

## Stale scaffold markers

Empty `{ todo }` rows that already have an executing test were removed from `test/diagnostics.e2e.js` and `test/diagnostics-security.test.js`. `test/diagnostics-coverage-pointers.test.js` checks that each cited test name is still in the tree. Two Windows rows stay as todos and are not counted as E4:

- case 5 `taskkill /F`
- Windows `Get-NetTCPConnection` half of “no extra debugging TCP port”

## Integrated regressions actually run

| Suite | Result |
|---|---|
| `node --test` diagnostics security, contract, recovery, e2e, unit | 133 tests, 128 pass, 0 fail, 3 skip, 2 todo. The 2 todos are the Windows rows. The 3 skips were the external UI patch, later replaced by in-tree scans. |
| `test/diagnostics-security.test.js` after the in-tree UI scan | 25 pass, 0 fail, 0 skip |
| `npm run test:unit` (after the pinned Chromium install) | 134 pass, 0 fail. The first run failed one test because `chromium_headless_shell-1248` was not installed yet. |
| `npm run test:m3` `test:m4` `test:m6` `test:m7` `test:m8` `test:m9` | 34, 48, 8, 8, 6, 4 pass respectively, 0 fail |
| `test/diagnostics-live.test.js` | 12 pass, 0 fail |
| `test/diagnostics-gate.live.test.js` first run | 8 pass, 2 fail. `ss` was not installed (`spawnSync ss ENOENT`). The failed port check left a `.pm-lock`, which the later case-3 assertion counted. |
| `test/diagnostics-gate.live.test.js` after `iproute2` (`ss` on PATH) | 10 pass, 0 fail |
| `web/e2e/diagnostics-ui.mjs` first run | 51 pass, 3 fail. Global `.pill { text-transform: lowercase }` lowercased “Versions match”, “Unavailable”, and “Version mismatch”. |
| `web/e2e/diagnostics-ui.mjs` after `.pd .pill { text-transform: none }` | 54 pass, 0 fail |
| `npm run test:engine` | exit 0. Engine isolation/restart/crash checks and `test/lifecycle.e2e.js` (last-window close, app Stop, SIGKILL → Error, SessionEnded → Stopped) passed. Linux SIGKILL is not the Windows `taskkill /F` case. |

Logs: `evidence/regression-targeted.log`, `evidence/unit-rerun.log`, `evidence/regression-browser.log`, `evidence/regression-rerun.log`.

Contract file used: `docs/handoff/m2/contracts/DiagnosticsV1.original.md` (SHA-256 `cd1ce49f379566efa0fa65ed81f5402f21259191cbdb6aa6088eb8413b8059d8`). Amendment `DiagnosticsV1.process-command-line.md` matches `e80ce2d513e610a18c703b775fb0fd5520e3eb1ca5dce6f4ad43a1eecf08bdf4`.

## Still open, and not closed by this file

- Windows 10/11 execution of the smoke package.
- M2 case 5 (`taskkill /F`).
- Windows TCP-port half of §10.
- Cookie values Chromium encrypts with DPAPI (`unsupported_encryption` until a Windows run says otherwise).
