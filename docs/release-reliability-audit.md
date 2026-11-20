# Release reliability audit (AZWAH Ultimate 2.0)

Scope: the areas the release mission listed. Each was checked by reading the code path and the tests that cover it, and, where the Windows CI gates had produced evidence, by root-causing those runs. "Fixed" items include a test that fails without the fix.

## Summary

| Area | Result | Evidence |
|---|---|---|
| Profile lock / browser PID | **Fixed earlier** (52db563): transient Windows read errors made `updateLock` drop `browserPid` | 4 lock unit tests; lifecycle e2e on Windows |
| Live verification probe | **Fixed** (58cad4b): the probe opened camera/microphone/local-fonts permission prompts and hung on default Chrome Stable profiles | `test/observe-no-prompt.test.js`; live Windows test |
| Port-scan protection after relaunch | **Fixed** (d5af883): Chromium's Local Network Access split dropped the deny from the second launch on; loopback was never denied; verification passed without loopback evidence | `test/port-scan-restart.test.js`, `test/observe-repeat-api.test.js`, live Windows test (native run 44553471309) |
| Verification probe cleanup | **Fixed** (30f79b5): cleanup waited for Chrome's keep-alive connection and discarded collected facts | `test/observe-repeat-api.test.js` (fails on the old probe) |
| Follow-proxy timezone grading | **Fixed** (257c4f2): a correct proxy-following zone was graded against the computer's zone | `test/fingerprint-consistency.test.js`; DB-IP live test |
| Proxy location probe at launch | **Fixed** (410f7db): one transient reset failed the launch (seen twice in CI) | `test/proxy-location.test.js` |
| Native runtime proxy watchdog | **Fixed** (410f7db): one transient reset stopped a running native profile | same retry helper |
| Default advanced settings constant | **Fixed** (410f7db): `DEFAULT_ADVANCED_SETTINGS` lacked the `runtime` every profile gets | `test/advanced-settings-api.test.js` |
| Bookmarks JSON export | **Fixed** (58cad4b): root names repeated in folder paths | `test/bookmark-import.test.js` round trips |
| Crash recovery | OK, one low-risk note | `test/m17-crash-recovery.test.js` (installer gate) |
| Action synchronizer cleanup | Fixed in finding 6 | `test/action-sync-browser.test.js` (native gate) |
| Cookie robot cancel | Fixed in finding 6 | `test/cookie-robot-cancel.test.js` (native gate) |
| Extensions | OK | `test/extensions*.test.js`; Chrome Stable refuses unpacked extensions with a reason |
| Backup integrity | OK, one note | per-file SHA-256 manifest verified on restore; encrypted backups are AES-256-GCM |
| Migrations | OK | additive; backed up before migrating; idempotent (`test/browser-settings-api.test.js`, `test/migration-v13-v16.test.js`, `test/upgrade-data-depth.test.js`) |
| Cookie import, Chrome Stable | **Fixed** (finding 8): Chrome Stable discarded cookies imported into a stopped profile | `test/cookie-import-stable-windows.test.js` (native gate), `test/stable-cookies.test.js`, upgrade gate |
| Installer upgrade | OK, see `docs/in-place-upgrade.md` | the installer gate upgrades the pinned predecessor in place on the default data folder with populated data, an interrupted install and the old app running; profiles, settings, cookies, bookmarks, storage and proxy credentials survive. A newer schema is now refused (`SCHEMA_TOO_NEW`) |
| Update checksum | OK | `test/update-loopback-e2e.test.js` serves a tampered installer and expects the update to be refused |

## Fixed findings

### 1. Verification probe opened permission prompts (high)
`observeInPage` called `navigator.mediaDevices.getUserMedia()` and `window.queryLocalFonts()` unconditionally. On real, headed Chrome Stable an undecided permission opens a prompt that waits for a person. On a default profile the probe hung until its 35 s deadline, so the whole report came back "unavailable", and the user saw an unexpected camera/microphone prompt. The live Windows test caught this on profile B. Profile A passed only because its permissions were set to deny.
**Fix:** permission states are read first, and those APIs are called only when the permission is already decided (geolocation already followed this rule). Undecided permissions are recorded as `permission_not_decided` and graded `unavailable`. A missing fonts result could previously fall through to `pass`, and that path is closed. Granted capture tracks are stopped.

### 1b. Port-scan protection weakened after relaunch (high)
Found by the live Windows test at `30f79b5`. After a Chrome Stable profile was stopped and relaunched, verification showed port-scan protection as **warning**. The first launch had shown **pass**.

**Root cause.** Chromium has split Local Network Access into two content settings, `local_network` and `loopback_network`. It migrates the legacy `local_network_access` default once and records that it did so (`has_migrated_local_network_access`), but it does not persist the migrated value under the new keys. AZWAH wrote only the legacy key. As a result:
- from the second launch on, the legacy key was ignored and every Local Network Access permission fell back to "ask";
- even on the first launch, `loopback-network` stayed "ask";
- verification queried only the legacy permission name, so the first launch passed without evidence for loopback.

The failure reproduced locally with bundled Chromium through the same launch → stop → relaunch lifecycle, so it was not specific to Chrome Stable.

**Impact.** With "ask", pages in a headless browser are still blocked, because nobody can accept the prompt. In a visible browser, a page could prompt the user, and an accepted prompt let it probe loopback and LAN ports. Protection was weakened, not disabled.

**Fix.**
- The preference writer denies `local_network` and `loopback_network` as well as the legacy key, on every launch. Existing profiles are repaired on their next launch.
- The probe also observes the `local-network` and `loopback-network` permissions. Port-scan protection passes only when every observed permission is denied, and it is `unavailable` without an observation.

**Evidence.** Native run [44553471309](https://github.com/qadeer-cyber/profile-manager/actions/runs/44553471309) at `d5af883`:
- portScan is **pass** for both simultaneous Chrome Stable profiles, for A after a setting change, after a first restart and after a second restart.
- `port-scan-restart` (one profile relaunched 4×, two simultaneous profiles relaunched 3×; every permission denied and a public page cannot reach a loopback port) and `observe-repeat-api` (API launch, Verify and stop 3×) pass. Both fail on the previous code.

### 2. Launch failed on one transient exit-probe error (medium)
The Windows installer gate failed twice (67cb8a3 over SOCKS5, 584f145 over HTTP) with `503 PROXY_UPSTREAM_UNAVAILABLE`: a connection reset between the proxy and the exit-IP service. The Chrome Stable watchdog already retried a transient failure once, but the launch-time probe did not.
**Fix:** `resolveProxyLocationWithRetry` retries once after 1.5 s, and only for transient codes (timeout, upstream reset, exit service 5xx). Authentication failures, exit rotation and invalid data fail immediately, and the exit IP is still verified on the retry. It is used by the Chrome Stable launch plan, the native runtime and the privacy engine.

### 3. Native runtime stopped a running profile on one transient error (medium)
The native runtime's 30 s recheck had no retry, so its `catch` killed the browser after a single reset. It now uses the same bounded retry. Rotation and assignment changes still stop the profile as before.

### 4. `DEFAULT_ADVANCED_SETTINGS` did not match stored defaults (low)
This was the `advanced-settings-api.test.js` mismatch, and it was already on `main` (787ccd5). `finishAdvanced()` stores `runtime: 'compatibility'`, but the exported default constant had no `runtime`. The constant now includes it, and normalized values are unchanged.

### 5. Ungated suites had drifted (process)
The npm scripts `test:m3`, `test:m6`, `test:m10`, `test:m11` and other milestone suites run in no workflow that triggers on this branch, so their expectations had drifted from intended behavior. The drift: launches with ids that have no profile row, a migration list frozen at v12, and the port-scan default. The launch and settings tests are updated to assert the intended behavior. Remaining ungated failures are listed under open items; none is a product defect found so far.

### 6. Concurrent lock takeover, stopped synchronizers and in-flight robot cancellation

| Area | Root cause and repair | Regression evidence |
|---|---|---|
| Profile ownership | On the original branch, three independent processes all reported ownership of one stale lock. Removal and acquisition were separate operations, and PID updates did not check ownership. A short SQLite writer transaction now covers each metadata mutation. A fresh token identifies the lease, and an asynchronous recovery pass reserves it while checking the browser PID and updating the database. Persistent sharing errors propagate to contenders. The acquiring process can repair its metadata after checking file identity. | `test/profile-lock-process.test.js` and its IPC worker, the existing Windows sharing-error tests in `test/unit.test.js` and `test/m17-crash-recovery.test.js`. |
| Action Synchronizer | Stop kept the session and closures referencing browser contexts. A Stop during asynchronous setup could also install listeners after cleanup. Stop now detaches listeners, cancels deferred navigation, clears session references and keeps bounded summaries. Context closure and server shutdown stop affected sessions. Input events carry the session ID. | `test/action-sync-lifecycle.test.js` stops during attachment and closes a follower over 80 cycles. `test/action-sync-browser.test.js` exercises real browser forwarding and isolation. |
| Cookie Robot | Cancellation only set a flag. Navigation, backoff and delays could continue, redirect listeners remained on reused personal tabs, and cancellation could discard untouched tasks. An abort signal closes the dedicated job tab and interrupts waits. Each completed task is persisted and cleanup precedes retry. | `test/cookie-robot-cancel.test.js` exercises two blocked navigations. `test/cookie-robot-navigation-cancel.test.js` uses live CDP, a server that never responds, an existing tab and a cookie marker. |

The lock protocol covers processes running the new source on a local filesystem. Earlier builds do not participate in its SQLite guard. Physical Windows clients and authenticated external proxies remain on the Windows client checklist.

### 7. Fresh-install admission limit and installed coverage

With a running-profile limit of one and zero live browsers, three sequentially admitted requests all returned TOO_MANY_PROFILES before reaching profile preflight. The calculation combined live entries, the launching map and queue reservations. These overlap. The corrected admission check counts unique live and admitted profile IDs, and releases each reservation on failure. The local reproducer is in `test/launch-limits-local.test.js`. The Windows installed gate checks four live profiles when memory permits and requires the next launch to be refused.

The former fresh-install smoke checked one blank tab. `scripts/windows-qualification/fresh-install.mjs` now drives a separate normal installed desktop through its own renderer and backend, with an explicitly empty temporary user-data directory. It records observed storage, lifecycle outcomes and process measurements, and leaves the historical upgrade test intact. The post-upload readback compares the distributed EXE with the tested build.

### 8. Chrome Stable discarded imported cookies (high)

`POST /api/profiles/:id/cookies/import` is shared by JSON import, Netscape cookies.txt import and encrypted-archive import (`/cookies/import-encrypted`). For a stopped profile it wrote rows to the SQLite store with `encryptCookieValue()`, which uses a `v10` prefix, Chromium's fixed basic key (PBKDF2 of `peanuts`) and a SHA-256 host prefix. That is the format of bundled Chromium on Linux. On Windows, Chrome Stable keeps a random AES-256 key in the profile's `Local State` (`os_crypt.encrypted_key`, protected with DPAPI) and writes `v10` values with AES-256-GCM under that key. The prefix is the same three bytes as the basic-key format, but the cipher and key differ. Chrome cannot decrypt a basic-key value, so it drops the cookie when it loads the store. App-bound encryption (`app_bound_encrypted_key`, `v20` values) is not in use for these profiles: Chrome 157.0.8103.79 created only `audit_enabled` and `encrypted_key` in the app's own user-data directories.

Evidence: the installer upgrade gate at ea7e697 (job 135805602731) logged the imported cookie as present after import and `null` after Chrome Stable ran the profile once. The new native-gate test (`test/cookie-import-stable-windows.test.js`) reproduces it directly and logs only key names and blob prefixes, never values:

| Run (Windows native gate) | Commit | `os_crypt` keys | Prefix after import | Prefix after Chrome ran | In Chrome after relaunch |
|---|---|---|---|---|---|
| 44597661588 (fails, test only) | 99e9755 | `audit_enabled`, `encrypted_key` | `v10` (basic key) | not reached | neither cookie (`inStore: false`) |
| 44598639148 (passes, with fix) | 81b9804 | `audit_enabled`, `encrypted_key` | `v10` (Chrome's key) | `v10` | both, values match, host-only kept; HttpOnly hidden from `document.cookie`; clear removes only the selected cookie |

Fix: for Chrome Stable profiles on Windows (`advancedSettings.runtime: 'stable-chrome'`, or every Chromium profile in the Chrome Stable edition), `server/browser-runtime/stable-cookies.js` performs the write in Chrome. It holds the profile lock and checks the profile was not last opened by a newer Chrome. It then launches headless Chrome Stable on the profile. Proxy traffic goes to a closed loopback port and background networking is off, so nothing reaches the internet. Host-only cookies are passed to CDP `Network.setCookie` by URL and domain cookies by dotted domain, and Chrome's read-back must match name, scope, value and flags. Any mismatch rolls the request back and returns 422. A graceful close flushes the store, encrypted with Chrome's own key.

Not changed: clearing cookies deletes rows by host, name and path, which needs no decryption and is verified in Chrome by the same test. Running profiles still refuse cookie changes (`PROFILE_RUNNING`). Backups copy the profile folder, including `Local State`, together with the cookie store. That keeps Chrome's own key with its cookies, but the key is DPAPI-protected for the Windows account that created it, so a restore under another account or on another computer cannot be expected to keep Chrome Stable cookie values. This follows from the format and is not yet covered by a test.

## Notes (not changed; low risk)

- **Crash recovery** still skips corrupt locks in the startup sweep. The next acquisition handles them. A profile folder removed during directory enumeration can interrupt that sweep.
- **Backup integrity vs authenticity.** Unencrypted `.pmb` files carry per-file SHA-256 checksums that are verified on restore. That catches corruption, not deliberate tampering: legacy backups without a manifest skip the check. Use encrypted backups (AES-256-GCM, authenticated) for files that leave the computer.

## Release-candidate stabilization (2026-11-20, source `e0d4c3d`)

- Stop telemetry race fixed and verified over 30 live Stop/restart cycles; `--host-resolver-rules` shown to be applied by Chrome 157; Chrome-missing message corrected; installer read-back retried once after a pause. Evidence and open items: `docs/release-candidate-evidence.md`.

## Open items

- Manual Chrome Stable profiles (Option A): automation detection on Google, Walmart and Facebook must be re-tested by the owner on a physical Windows PC. A local `navigator.webdriver` check is a diagnostic, not proof of site acceptance.
- Fixed during Option A CI (`0602d40` → `4f16d32`): Stop force-killed manual Chrome (`taskkill /T /F`) and lost unwritten cookies and localStorage. Stop now closes the window normally first. The live webdriver-signal step checks persistence across restart.

- Upgrades with the old app open: the silent installer closes the old app and its running browser without a prompt (observed in CI). Interactive installs and physical Windows 10/11 upgrades from a user's real previous version are unverified.


- Ungated suites (no workflow runs them on this branch), triaged locally after the fixes:
  - Pass: `test:m3` 34/34, `test:m4`, `test:m6`, `test:m7`, `test:m9`, `test:m12`, `test:m13`, `test:m14`, `test:trackc`, `test:ultimate3-track-b`, `test:m4:browser`.
  - Fixed stale tests (behavior is intended):
    - `test:unified`: the migration list was frozen at v19.
    - `test:m7:browser`: DELETE now moves a profile to Trash, so the restore must use `collision=rename`.
    - `test:e4`: the recovery summary line is printed just after the URL line the harness waits for. With that read race fixed, the test confirms that restart clears stale running records and locks, so crash recovery works.
  - Local sandbox only: `test:m10`, `test:m11`, `test:m14-m16` and `test:m6:browser` each fail one version-equality check because this sandbox's Chromium is 153 and the app pins 156. `test:alpha3-upgrade` requires Windows.
- A real Windows 10/11 client run of the qualification checklist (`docs/windows-client-qualification.md`). CI runs on Windows Server 2022.
