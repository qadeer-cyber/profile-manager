# Codex stabilization checkpoint — 2026-10-30

This is a partial engineering checkpoint, not Ultimate 2.0 completion or release approval.

## Source and isolation

- Repository: `qadeer-cyber/profile-manager`.
- Branch: `codex/ultimate2-local-completion`.
- Verified upstream parent: `b872f13d96ecdb2165875b7a740849d6e5f8dc96`.
- Source retrieved through the connected GitHub API because command-line Git authentication was unavailable. All 405 file blobs, the complete tree (`0688752ccf5777ac29b8c0b0168a89f45865630f`), and signed parent commit object were reconstructed and hash-verified locally. The local checkout is shallow at that parent.
- Final commit: the commit containing this report; resolve with `git rev-parse HEAD` on this branch. Tests below ran against its application/test source before the documentation/evidence files were committed.
- The existing feature branch, Alpha.3 release, and installer-qualified `b3349af0fd236cb7a4898dd5083eca5e2210840b` were not changed.

## Implemented and corrected

1. XPI validation now checks archive/member sizes, entry counts, bounded stored/deflated decompression, data descriptors, CRCs, central/local consistency, overlap, duplicate names, Unicode/case aliases, unsafe Windows paths, links/special files, manifest shape and safe Gecko identity. Fabricated Mozilla filenames no longer establish signing. Imports clean up their newly created library copy after database insertion failure. No new dependency.
2. Offline Firefox `extensions.json` writes and unsupported automatic directory-copy installation were removed. Toggle returns an explicit 501 capability limitation. Firefox inventory assignments leave browser files unchanged. The UI and capability report explain manual installation/management. Firefox library removal now addresses Gecko storage rather than the Chromium storage path. Import is never reported as verified installation.
3. Portable restore now encloses database mutations and file movement in the same transaction, with rollback checks after movement and on orphan-directory collision. Validates identity, manifest/profile agreement, future schema and unrelated files. Portable rollback failure retains recovery files. Backup preview validates declared checksums. Profile-root symlinks and Windows archive aliases/streams are rejected.
4. Purge intent is recorded before filesystem deletion. Startup reports interrupted purges without automatically retrying destructive cleanup. Trash restore rejects a known incomplete profile, and UI directs recovery to backups. Database deletion failure preserves purge evidence. Trash confirmation dialogs no longer overlap.
5. HTTP fixtures close active sockets and clean up on assertion failure. Playwright reconnect uses a local fixture. CookieRobot fixtures run headless and register spawn-error handlers. Browser regression files have a 180-second deadline.
6. Firefox launch tests now isolate the database before importing modules with DB side effects. This fixes tests leaking fake executable settings into the default shared database. Firefox absence is a real test skip, not a printed SKIP followed by a passing result.
7. Fixed stale migration test expectations and a missing resourceSnapshot export in the app security mock. Extension API tests explicitly purge disposable trashed clones before expecting assignments to disappear; trash recovery behavior is retained.
8. Replaced fixed ChromeDriver/CDP ports and blind startup sleep in the real WebDriver qualification test. Prepared Chrome/Gecko tests for readiness, navigation, Unicode interaction, persistent-profile separation and cleanup. Both remain opt-in and unexecuted here.
9. Enabled ordinary source CI on the isolated Codex branch pattern. Installer-smoke conditions were not expanded. No manual workflow dispatch.

## Verification

Platform: Linux 6.18.57 x64, Node v24.22.1, npm 11.9.0. Windows CI uses Node 22 and still needs qualification. Counts overlap between suites and must not be added together as unique test coverage.

| Exact command | PASS | FAIL | SKIP | Duration |
|---|---:|---:|---:|---:|
| `npm run test:stabilization` | 89 | 0 | 0 | 4.242 s |
| Source subset command below | 140 | 0 | 1 | 6.607 s |
| `npm run test:unit` | 133 | 1 | 0 | 27.295 s |
| `node --test --test-timeout=30000 test/webdriver-real.test.js` | 0 | 0 | 2 | 0.359 s |
| `npm run build` | build passed | — | — | Vite 0.295 s |
| `git diff --check` | passed | — | — | — |

```sh
node --test --test-timeout=30000 --experimental-test-module-mocks test/browser-runtime-native-launch.test.js test/native-tab-restore-launch.test.js test/profile-table-workspace.test.js test/profile-config-engine.test.js test/profile-lifecycle-trash.test.js test/firefox-launch-plan.test.js test/firefox-proxy-locale.test.js test/firefox-gecko-prefs.test.js test/firefox-gecko-userjs.test.js test/gecko-cookies.test.js test/firefox-cookies-api.test.js test/profile-lifecycle.test.js test/profile-lifecycle-purge.test.js test/upgrade-data-depth.test.js test/session-harvest.test.js test/automation-cli-smoke.test.js test/p1-google-compat.test.js test/extensions.test.js test/extensions-launch.test.js test/update-manager.test.js test/webdriver-bridge.test.js test/webdriver-api.test.js test/geckodriver-bridge.test.js test/firefox-spawn-smoke.test.js test/migration-v13-v16.test.js test/workspaces.test.js test/cookie-robot-jobs.test.js test/cookie-robot-url.test.js test/cookie-robot-cancel.test.js test/advanced-launch-window.test.js test/proxy-duplicate.test.js test/launch-limits-local.test.js test/profile-browser-export.test.js test/adb-adapter.test.js test/browser-window-actions.test.js test/automation-drivers.test.js test/firefox-regional-observable.test.js test/fingerprint-privacy-launch.test.js test/gecko-extensions.test.js test/firefox-launch-window.test.js test/profile-backup-export.test.js test/backup-selective.test.js test/gecko-xpi.test.js test/window-state.test.js test/workspaces-api.test.js test/adb-devices-parse.test.js test/proxy-providers.test.js
```

The source subset explicitly excludes six browser-required files: CookieRobot CDP/lifecycle, fingerprint observable API, Playwright reconnect, Puppeteer attach, human input. These exclusions are local execution limitations, not CI skips or substitutes for browser evidence. The full browser-runtime command retains those files. The one source-subset skip is Firefox host spawn: no installed Firefox.

The remaining full-unit failure is the real Playwright browser-child test: its pinned Chromium headless shell does not exist. `npx playwright install chromium` failed with HTTP 403 “Domain not in allowlist” from cdn.playwright.dev after invalid/truncated downloads. The assertion was not removed or skipped. Native SQLite loaded successfully from its packaged Linux prebuild; a separate attempted rebuild failed extracting Node headers (fchown EINVAL). Dependencies were installed using `npm ci --ignore-scripts`; Electron installation/desktop runtime was not qualified.

The two WebDriver tests are opt-in skips, not evidence of functioning real browsers. Run on a suitable host using PM_REAL_WEBDRIVER=1 / PM_CHROMEDRIVER_PATH and PM_REAL_GECKODRIVER=1 / PM_GECKODRIVER_PATH (optional PM_FIREFOX_PATH), respectively. No genuine signed Firefox add-on was installed during this checkpoint.

Logs: `codex-evidence/`. The initial targeted run passed 25/0/0; the intermediate 63-test run initially failed an outdated hard-delete assumption, which was corrected to confirmed disposable-profile purge and rerun green. Initial source/unit failures and final results are distinguished above; the full unit command is still red.

## CI and release evidence

- Existing Phase One run: https://github.com/qadeer-cyber/profile-manager/actions/runs/41046838158 — API reports Browser runtime + P1 regression in progress and installer job skipped. Live job logs returned 404, so the specific remote hanging test is not established. The fixture leaks and shared database interference are verified source defects, not a claimed diagnosis of that entire remote run.
- Historical installer reference: https://github.com/qadeer-cyber/profile-manager/actions/runs/40950595111 . Applies only to its older source, not this checkpoint.
- This push may start ordinary source CI; no green Windows result is claimed before its completion.
- No PR, merge, tag, release, paid resource, or installer-smoke dispatch. No personal browser profile was uploaded. All destructive tests use temporary disposable fixtures.
- Owner §19 sign-off: NOT GRANTED. Preview publication: NO-GO.

## Progress and remaining work

Scorecard A retains the original 45 categories: 18 VERIFIED, 20 PARTIAL, 5 UNSUPPORTED, 0 MISSING, 2 NOT_APPLICABLE_CLOUD. Weighted historical score: (18 + 0.5 × 20) / 43 = **65.1% → 65.1%, +0.0 percentage points**. No category was promoted. The inherited VERIFIED entries are historical classifications, not a complete requalification on this host.

Scorecard B: the existing 88.9% local-product parity score is a legacy 18-area measure and does not cover this new completion specification. A comprehensive new feasible-local completion percentage has not been established; presenting that legacy value as completion would be misleading. No percentage increase is claimed. Difficult local requirements remain in scope.

Known unfinished work includes full fresh-install `.pmp` dependencies (workspace records, proxy credentials and extension files), full-backup Gecko library preservation and engine/workspace restoration, durable restore journaling across process interruption, preservation/recovery after partial filesystem purge, supported application-integrated GeckoDriver add-on lifecycle with genuine signed-extension/restart/isolation evidence, Windows multi-monitor/DPI/maximized-state qualification, measured traffic controls, provider live qualification, full CLI, Firefox input, Android device qualification, desktop workflow tests and physical Windows 10 performance testing. Browser/Windows unavailability blocks qualification, not all future source implementation.

Next reproducible checkpoint: inspect the new Windows source run without dispatching installer jobs; reproduce the exact test named by its logs. On an allowed host install the lockfile-matched Playwright browser and run the unchanged full `test:browser-runtime`, `test:unit`, and real WebDriver gates. Then complete P0 backup/purge crash-recovery and Firefox lifecycle before broad feature promotion. This turn does not claim background work continues.

## Mozilla references used for capability wording

- https://support.mozilla.org/en-US/kb/add-on-signing-in-firefox
- https://firefox-source-docs.mozilla.org/devtools-user/about_colon_debugging/
- https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/

## Files changed

- `.github/workflows/dedicated-browser-engine-win.yml`
- `docs/handoff/multilogin-platform/MULTILOGIN_COMPLETE_TECHNOLOGY_MATRIX.md`
- `docs/handoff/multilogin-platform/RELEASE_GATES_SECTION19.md`
- `docs/handoff/multilogin-platform/codex-evidence/build-linux.log`
- `docs/handoff/multilogin-platform/codex-evidence/source-subset-linux.log`
- `docs/handoff/multilogin-platform/codex-evidence/stabilization-linux.log`
- `docs/handoff/multilogin-platform/codex-evidence/unit-linux.log`
- `docs/handoff/multilogin-platform/codex-evidence/webdriver-opt-in-linux.log`
- `package.json`
- `server/archive.js`
- `server/backup.js`
- `server/extensions.js`
- `server/gecko-extensions.js`
- `server/gecko-xpi.js`
- `server/profile-config-engine.js`
- `server/profile-lifecycle.js`
- `test/_isolated-data.mjs`
- `test/_local-http-fixture.mjs`
- `test/_xpi-fixture.mjs`
- `test/app-security.test.js`
- `test/backup-selective.test.js`
- `test/backup.test.js`
- `test/cookie-robot-cdp.test.js`
- `test/cookie-robot-lifecycle.test.js`
- `test/extensions-api.test.js`
- `test/firefox-cookies-api.test.js`
- `test/firefox-gecko-prefs.test.js`
- `test/firefox-gecko-userjs.test.js`
- `test/firefox-launch-plan.test.js`
- `test/firefox-launch-window.test.js`
- `test/firefox-proxy-locale.test.js`
- `test/firefox-regional-observable.test.js`
- `test/firefox-spawn-smoke.test.js`
- `test/fixture-cleanup.test.js`
- `test/gecko-extensions.test.js`
- `test/gecko-xpi.test.js`
- `test/playwright-cdp-reconnect.test.js`
- `test/profile-lifecycle-purge.test.js`
- `test/puppeteer-cdp-attach.test.js`
- `test/unit.test.js`
- `test/webdriver-real.test.js`
- `web/src/pages/ExtensionsPage.jsx`
- `web/src/pages/TrashPage.jsx`
- `docs/handoff/multilogin-platform/CODEX_STABILIZATION_CHECKPOINT.md`
