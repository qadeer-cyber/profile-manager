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
| Action synchronizer cleanup | OK, one low-risk note | `test/action-sync-browser.test.js` (native gate) |
| Cookie robot cancel | OK, one low-risk note | `test/cookie-robot-cancel.test.js` (native gate) |
| Extensions | OK | `test/extensions*.test.js`; Chrome Stable refuses unpacked extensions with a reason |
| Backup integrity | OK, one note | per-file SHA-256 manifest verified on restore; encrypted backups are AES-256-GCM |
| Migrations | OK | additive; backed up before migrating; idempotent (`test/browser-settings-api.test.js`, `test/migration-v13-v16.test.js`, `test/upgrade-data-depth.test.js`) |
| Installer upgrade | OK | installer gate rebuilds a pinned predecessor, upgrades in place and checks profile IDs and the database survive |
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

## Notes (not changed; low risk)

- **Lock takeover race (cross-process).** `acquireLock` removes a stale lock and retries. Two *processes* that both decide a lock is stale could in theory remove each other's fresh lock. AZWAH runs one server process (Electron single-instance lock), and launches inside it are serialized, so this needs two app instances on one data folder. A compare-before-remove (rename to a unique name, then verify) would close it.
- **Crash recovery** skips corrupt locks in the sweep. `acquireLock` treats them as stale, so they clear on the next launch instead of at startup. A `statSync` race on a profile folder deleted during the sweep would abort the sweep for that pass.
- **Action synchronizer** keeps stopped session summaries in memory for the life of the process (a few hundred bytes each). Sessions stop on request, when the leader closes and when any participant stops (`profileStopped` is wired to the engine's stop event).
- **Cookie robot cancel** is checked between tasks and before connecting. A navigation already in progress finishes or times out (bounded) before the cancel takes effect.
- **Backup integrity vs authenticity.** Unencrypted `.pmb` files carry per-file SHA-256 checksums that are verified on restore. That catches corruption, not deliberate tampering: legacy backups without a manifest skip the check. Use encrypted backups (AES-256-GCM, authenticated) for files that leave the computer.

## Open items


- Ungated suites (no workflow runs them on this branch), triaged locally after the fixes:
  - Pass: `test:m3` 34/34, `test:m4`, `test:m6`, `test:m7`, `test:m9`, `test:m12`, `test:m13`, `test:m14`, `test:trackc`, `test:ultimate3-track-b`, `test:m4:browser`.
  - Fixed stale tests (behavior is intended):
    - `test:unified`: the migration list was frozen at v19.
    - `test:m7:browser`: DELETE now moves a profile to Trash, so the restore must use `collision=rename`.
    - `test:e4`: the recovery summary line is printed just after the URL line the harness waits for. With that read race fixed, the test confirms that restart clears stale running records and locks, so crash recovery works.
  - Local sandbox only: `test:m10`, `test:m11`, `test:m14-m16` and `test:m6:browser` each fail one version-equality check because this sandbox's Chromium is 153 and the app pins 156. `test:alpha3-upgrade` requires Windows.
- A real Windows 10/11 client run of the qualification checklist (`docs/windows-client-qualification.md`). CI runs on Windows Server 2022.
