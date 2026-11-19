# Changelog

This project records changes by **verified milestones**. Git tags and package versions are not inferred from branch names. Release artifacts are separate from source acceptance.

## Unreleased — AZWAH Ultimate 2.0 workspace on `feature/azwah-ultimate-2` (PR #27)

Draft PR. No main merge, release tag or published installer. Installer version metadata is `2.0.0-beta.1`.

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
