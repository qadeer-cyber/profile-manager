# Changelog

This project records changes by **verified milestones**. Git tags and package versions are not inferred from branch names. Release artifacts are separate from source acceptance.

## Unreleased — AZWAH Ultimate 2.0 workspace on `feature/azwah-ultimate-2` (PR #27)

Draft PR. No main merge, release tag or published installer. Installer version metadata is `2.0.0-beta.1`.

### In-place upgrade qualification

- Windows installer acceptance now upgrades the real pinned predecessor (`4a45831`, *Azwah Multi Browser Ultimate*) to *AZWAH* in place on the default data folder, with populated synthetic data. It covers an interrupted install, an upgrade while the old app runs a browser, and the new version reading every profile, folder, tag, note, cookie, bookmark, browser storage and saved proxy credential. See `docs/in-place-upgrade.md`.
- A build that finds a database written by a newer AZWAH now refuses to start and changes nothing (`SCHEMA_TOO_NEW`).
- Found: the silent installer closes a running old app and its browser before replacing it.

### Fresh Windows installation qualification

- Fixed the running-profile limit counting the request itself and counting waiting requests multiple times. Admitted launches reserve one slot until completion. The configured maximum now permits that many browsers while retaining the free-memory guard.
- Windows installer acceptance now exercises the installed desktop with an empty store, opens multiple signed Chrome Stable profiles, checks browser storage and crash recovery, samples working sets and verifies the downloaded CI installer against the build output.

### Cookie import into Chrome Stable profiles

- Fixed: cookies imported into a stopped Chrome Stable profile on Windows (JSON, Netscape cookies.txt or an encrypted cookie archive) were listed after import, then lost on the next run. The importer wrote values with Chromium's fixed basic key, as bundled Chromium uses. Chrome Stable encrypts cookies with its own key in the profile's `Local State`, so it could not decrypt those values and discarded them.
- Chrome Stable profiles now import through Chrome. The stopped profile opens briefly in headless Chrome Stable with all network traffic sent to a closed local port. The cookies are set over CDP, read back and checked against the request, and Chrome closes so it writes them to disk. A cookie Chrome rejects or changes fails the whole request with 422 `COOKIE_REJECTED_BY_CHROME`. Cookies the request added are removed and any it replaced are restored. If Chrome cannot start, the response is 503 `CHROME_STABLE_COOKIE_WRITE_FAILED`. The response includes `writtenBy: "chrome-stable"`.
- The stopped-profile cookie list no longer tries the basic key on Chrome Stable values. Those values are reported as unavailable (`unsupported_encryption`), with names and flags still listed.
- Bundled Chromium import and clear are unchanged. Clear on Chrome Stable deletes rows, which needs no decryption. Session cookies follow Chrome's own rule and survive a restart only if the profile restores its previous session.
- Native gate: `test/cookie-import-stable-windows.test.js` imports into a stopped profile and checks the cookies in Chrome's CDP store and `document.cookie`. The installer upgrade gate imports a cookie in the new version and checks Chrome reads it.

### Release reliability hardening

- Profile lock takeover, PID updates and release use a cross-process SQLite writer lock and an ownership token. Crash recovery reserves the profile before changing its running row or singleton files.
- Stopping synchronization releases session, page and context listeners and pending navigation timers. Recent Stop responses retain up to 64 summaries. Credential-marked fields and clipboard shortcuts are excluded, as are navigation URLs with credentials, query strings or fragments.
- Cookie Robot uses a dedicated tab in the selected profile. Cancel closes that tab, interrupts retry delays and preserves the full URL list and completed progress. Retry waits for the old worker to finish cleanup.

### Milestone A — compact profile table (Windows CI verified at `bbd395a`)

- Profile rows are a single 48 px line (41 px with Compact rows) at 1024×768, 1366×768 and 1920×1080. They were 157–298 px at 1366×768.
- Row actions moved to a keyboard-accessible ⋮ menu. A Details dialog keeps the full proxy-exit evidence and native-runtime verification text.
- The toolbar, filters, table and pager share one card. Column widths are fixed, and columns drop by priority as the table narrows.
- Fixed: the Quick profile button always failed with HTTP 400.

### Milestone B — keyboard, focus and narrow layouts (Windows CI verified at `786b11b`)

- Dialogs and the profile editor move focus inside, keep Tab inside, close one layer per Escape, and return focus to the opener.
- The `/` and `n` shortcuts ignore modifier keys, text fields and open dialogs or menus.
- At narrow widths, less-used toolbar actions move into the overflow menu instead of clipping the search field.
- Notifications are announced to screen readers.
- The approved visual design is unchanged. The navigation rail proposal was declined.

### Milestone C — fingerprint settings (pushed at `15e8f52` and `60c171e`)

- All 16 fingerprint categories are visible in the Fingerprint tab. Modes that stock Chromium cannot apply (masked, noise, custom values and similar) appear as disabled options with the validator's reason. Proxy-following timezone and location are marked conditional on Chrome Stable or native runtimes.
- Verify Profile Settings reports one result per category from live browser observations. A category passes only when its observed checks passed, and nothing passes while the profile is stopped.
- The canvas and WebGL readback prototype controls were removed from the editor. Editor saves turn them off.

### Milestone D — online update qualification (Windows CI verified at `5e17aec`, run 44508916606)

- Windows CI builds Beta A (`2.0.0-beta.1`) and Beta B (`2.0.0-beta.2`) from the same source.
- Beta A's shipping updater finds, downloads and SHA-256-verifies Beta B from a loopback stand-in for GitHub Releases. The downloaded installer upgrades A in place, and every existing profile must survive.
- A tampered release digest must be refused.
- Observed on Windows Server 2022: A `2.0.0-beta.1` offered B `2.0.0-beta.2` (467,687,051 bytes, SHA-256 `6a955230…b063927`). The tampered digest was refused with "Installer integrity check failed." B started as `2.0.0-beta.2` with 1 of 1 profile IDs preserved, and then reported no newer update.
- A real published Beta A → Beta B run is planned for Milestone E, subject to the owner's approval.

### Not included

- No release is published. The canvas and audio noise, WebGL and WebGPU masking, and invented navigator hardware described in `FINGERPRINT_PARITY_MATRIX.md` remain unsupported on stock Chromium.

### Dolphin Anty / Multilogin expansion, part 1 (pushed at `fed1535`)

- `docs/azwah-capability-parity.md` is an evidence-based audit of 24 capabilities with code paths, CI-backed statuses and official competitor references.
- Device Identity presets: only presets the host engine can present are selectable. Other OS and mobile presets are visible, disabled, and refused by the server. Each preset is verified against the browser's platform and client hints. See `docs/device-identity-support.md`.
- The MAC address explanation is in the editor. A virtual-network environment is a deferred, approval-gated design (`docs/mac-virtualization-feasibility.md`).
- Netscape `cookies.txt` import and export are added. Import is all-or-nothing through the existing validator. Cookie tests now run in the Windows native gate.
- Action synchronizer: the person's own clicks, scrolling, key presses and navigation in a chosen leader profile are repeated in explicitly selected running followers. Password-field typing is never repeated. It covers the default Chromium and Chrome Stable runtimes only, and stops on request or when any participant stops. Tested with real Chromium (`test:sync`, Windows native gate).
- Cookie robot, extensions and backup tests now run in the Windows native gate (49 pass, 1 skipped for Windows symlink privileges). On Windows with Chrome Stable installed, a headed launch with unpacked extensions is refused with a clear error (`CHROME_STABLE_UNPACKED_EXTENSION`), and that behavior is now tested.
- Fixed: on Windows the profile lock could lose the browser PID when another process briefly held the file (`EBUSY`/`EPERM`), which hid the running browser from crash recovery. Lock reads now retry transient errors, writes are atomic, and an unreadable lock is rewritten by its owner. Verified by the Windows lifecycle race test (run 44532670648).

### Live verification, bookmarks import and release hardening (part 2; Windows CI verified at `30f79b5`, native run 44544596783, installer run 44544580530)

- **Live fingerprint verification on Windows.** A new native-gate step launches two real Chrome Stable profiles with different settings. For every category it checks that a "pass" is backed by what the browser actually exposed, that a stopped profile verifies nothing, that a setting changed while running reports a warning until relaunch, that settings survive a restart, and that timezone, languages and cookies stay isolated per profile. The DB-IP proxy-following test now also checks per-category timezone and geolocation verification.
- Fixed: for Chrome Stable profiles, verification compared the browser with the bundled Chromium version instead of the Chrome that was running.
- Fixed: Windows Server 2022 hosts were labelled as Windows 10 clients. Server now offers only *Match this computer*.
- Fixed: the verification probe opened camera/microphone and local-fonts permission prompts in the user's browser on default profiles, hung, and reported the whole profile as unavailable. It now never triggers a prompt.
- **Bookmarks import** for stopped Chromium profiles from Chrome/Edge/Brave `Bookmarks` JSON, AZWAH exports, or any browser's HTML export. The merge is additive: folders merge by name, a link already in the same folder is skipped, and only http(s) links are imported. The write is atomic and never damages existing bookmarks on failure. **HTML export** is added, and the JSON export no longer repeats root folder names. See `docs/bookmarks-import.md`.
- Fixed: a single transient network reset while checking the proxy's exit IP failed the launch (seen twice in CI), and in the native runtime it stopped a running profile. Launch and watchdog checks now retry once for transient errors only.
- Fixed: `DEFAULT_ADVANCED_SETTINGS` omitted the runtime every profile gets (the `advanced-settings-api` mismatch). Stale ungated settings tests now assert the intended behavior.
- Fixed: Verify could discard everything it had observed and report a running profile as unavailable, because the probe's cleanup waited for Chrome's keep-alive connection. ICE gathering is now also time-limited, and a failed observation reports which step failed.
- Fixed: a profile that follows its proxy was flagged because its timezone differed from the computer's. It is now graded against the proxy location's zone.
- Fixed (Windows CI verified at `d5af883`, native run 44553471309, installer run 44553453220): port-scan protection was weakened after a profile relaunch, and loopback was never denied, because Chromium split Local Network Access into `local_network` and `loopback_network`. AZWAH now denies all three settings on every launch. Verification checks every Local Network Access permission and passes only when all observed ones are denied.
- `docs/release-reliability-audit.md` (findings and notes) and `docs/windows-client-qualification.md` (what Server 2022 CI covers, and the Windows 10/11 physical-PC checklist).

## Unreleased — local fingerprint controls on `feature/m10-local-parity`

Source only. No installer, release tag, or main merge.

- Per-profile fingerprint settings can turn WebGL off, deny local-font access, and deny camera and microphone. Canvas, audio, and port-scan results stay the browser’s own. Substitute GPU, font, device, and noise values are rejected.
- A consistency report compares those settings with a live page. It does not mark a signal passed when the page was not read.
- The comparison with Multilogin’s fingerprint section is `FINGERPRINT_PARITY_MATRIX.md`.

## Unreleased — M8 and M9 on `feature/m8-m9-professional-parity`

Source only. No installer, release tag, or main merge is part of this branch.

- Dashboard, profile table, saved views, bulk jobs, and stopped-profile storage cleanup use the database and the live process.
- Optional AES-256-GCM backups use scrypt (N=16384, r=8, p=1). Older PMB1 backups still restore.
- Local automation adds batch operations and job status. Bright Data, Oxylabs Residential, and Webshare adapters follow those providers' published APIs. Manual proxy configuration remains.

## Unreleased — M1 integration to `main`

### Added and validated

- Native Windows/Electron workflow, with the optional offline installer gated behind `build_installers=true`.
- Persistent Chromium profile lifecycle, process-ownership and termination-evidence handling.
- Browser profile and proxy management, UI and API test coverage, and regression checks.
- Documentation describing building, development, architecture, and release procedures.

### Verification

- Source baseline: [`d7a000eeadd4f4645a608a1e0cc2b8ad154a75d9`](https://github.com/qadeer-cyber/profile-manager/commit/d7a000eeadd4f4645a608a1e0cc2b8ad154a75d9).
- Last recorded successful Windows native validation of that baseline: [Actions run #48](https://github.com/qadeer-cyber/profile-manager/actions/runs/39263296226).
- This integration preserves the main-branch CI commit and resolves the overlapping workflow in favor of the newer verified M1 version.
- No application source files are changed beyond the verified M1 tree by this integration.

### Not included

- **M2 DiagnosticsV1:** separate backend/UI/QA branches; both platforms passed the executed source tests in [run #52, attempt 2](https://github.com/qadeer-cyber/profile-manager/actions/runs/40533634628/attempts/2), but GitHub artifact-upload quota prevented formal evidence upload. M2 is **not signed off and not part of this integration**.
- **M3 locale/timezone/languages:** separate, in-progress feature branch. Not part of this integration.
- No installer build, version bump, or new release tag is claimed here.

## Earlier work

See Git commit history, [BUILD_AND_RELEASE.md](BUILD_AND_RELEASE.md), and [AI_HANDOFF.md](AI_HANDOFF.md) for prior Windows validation and release candidate history.
