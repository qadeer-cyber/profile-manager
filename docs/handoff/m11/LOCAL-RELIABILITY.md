# M11 local reliability (source only)

No cloud update service, no installer, no release tag change.

## Implemented on `feature/m10-local-parity`

- **Launch guards:** `maxRunningProfiles` (default 4) and `minFreeMemoryGiB` (default 1) in Settings / `server/launch-limits.js`. Returns `TOO_MANY_PROFILES` or `LOW_MEMORY` with a plain message.
- **Chromium compatibility:** `GET /api/browser/compatibility` and diagnostics report pinned vs executable version. A custom executable that does not match the pinned build is blocked with `CHROMIUM_VERSION_MISMATCH`.
- **Local update rollback:** Reinstalling Chromium moves the previous tree to `chromium-<rev>.pm-backup-<timestamp>` before download. Failed installs restore the backup. `GET /api/browser/backups`, `POST /api/browser/rollback`.
- **Crash recovery:** Unchanged M1 path — `recoverAfterRestart()` on server start clears stale running rows and locks when the pid is dead or fails the command-line check.
- **Fingerprint capabilities:** `GET /api/fingerprint-capabilities` documents supported modes and lists behaviors that need a custom Chromium build (no fabrication).
- **WebRTC observation:** Live ICE candidate types are collected on the Hardware read path. Consistency never compares ICE to the proxy IP.

## Still honest limits

- Rollback covers the Playwright browser directories under the local browsers root, not `%APPDATA%` profile data.
- Launch guards use OS free-memory snapshots; they do not reserve RAM.
- ICE collection uses a short STUN gather on a loopback test page; it is not a leak audit.
- Windows WebGL on Intel HD 620 is not proven until `scripts/windows-smoke/Run-M10-Latitude5480.ps1` runs on the laptop (BLOCKED in Linux CI).
