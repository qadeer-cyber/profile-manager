# In-place upgrade

How an existing AZWAH Ultimate installation is upgraded, what is preserved, and what is and is not protected. Evidence comes from Windows Server 2022 CI. Physical Windows 10 and 11 clients are still outstanding (see the end of this file).

## Supported path

| | Older installed version (baseline) | New version |
|---|---|---|
| Source | `4a45831` on `main` (pinned in `.github/workflows/azwah-ultimate-stable-chrome.yml`, rebuilt from that commit on every run) | this branch |
| Installer | `Azwah-Ultimate-Stable-Chrome-Setup-x64.exe` | `Azwah-Setup-x64.exe` |
| Executable | `Azwah Multi Browser Ultimate.exe` | `AZWAH.exe` |
| Installer identity (`appId`) | `local.azwahmultibrowser.ultimate` | the same, so the new installer upgrades the old one rather than installing beside it |
| Data location | `%APPDATA%\azwah-multi-browser-ultimate` | the same: Ultimate builds set it explicitly, so the product rename does not move it |
| Database schema | 21 migrations | the same 21. This path applies no database migration |

Older Office, Owner and plain *Azwah Multi Browser* editions use other data folders, and their upgrade to this Ultimate build is not qualified.

The baseline installer is rebuilt from source on each CI run and is not byte-reproducible: its size differed by one byte between runs. Each run verifies the installer it built against the checksum it recorded.

## What the CI gate does

`scripts/windows-qualification/upgrade-in-place.mjs`, the installer-acceptance step *Verify in-place upgrade on the default data location with populated data*, runs on a disposable runner with no `PM_USER_DATA` override, so both versions use the real default data folder. All data is synthetic, and the evidence holds counts, ids and SHA-256 digests only.

1. **Old version, populated** through its own API and browser:
   - three profiles with Unicode names, folders, tags and notes;
   - an authenticated HTTP proxy with a synthetic password;
   - an imported cookie;
   - cookies, localStorage and IndexedDB written by Chrome;
   - nested Unicode bookmarks.

   The gate records a manifest of ids, names, folders, tags, notes and proxy assignments, each profile's cookie view (names, flags, value digests) and digests of the data files.
2. **Interrupted upgrade.** The new installer is killed four seconds into a silent install. The data manifest must be unchanged. If the interruption removed the old app, the old version is reinstalled, and the data must still be unchanged.
3. **Upgrade retried while the old app is open with a browser profile running.**
4. **Both versions open.** If the old app survives the installer, the new app must not launch the profile the old one runs or kill its browser.
5. **New version on the same data.**
   - It opens the same data folder.
   - The manifest and the per-profile cookie views are identical.
   - Chrome sees the nested Unicode bookmarks (`chrome.bookmarks`), and each profile's cookies, localStorage and IndexedDB are present and not visible in the other profile.
   - The proxy password saved by the old version still decrypts and authenticates.
   - The app log does not contain it.
   - A cookie imported by the new version is readable by Chrome.

## Observed behavior (Windows Server 2022)

| Scenario | Result |
|---|---|
| Interrupted install | User data byte-for-byte unchanged in every run. In some runs the old app was already uninstalled when the installer was killed, and reinstalling the old version restored a working app on the same data. The retried new install then completed. |
| Old app open with a running browser | The new installer (silent mode) **closed the old app and its Chrome process** before replacing files, then completed (exit 0). The session open in that browser ends without a prompt. Profiles, cookies and storage written up to then were preserved. Interactive (non-silent) installs were not tested; whether they prompt before closing the app is unverified. |
| Both versions open at once | Not reached: the installer had already closed the old app. Code-level protection still applies. Each profile has an exclusive `.pm-lock` naming the owning process. The new version refuses a lock held by a live process or a live recorded browser, and crash recovery skips profiles whose lock owner is alive. Neither version kills a browser that another live instance owns. |
| Data after upgrade | All checks in step 5 passed. |

## Limits that cannot be enforced

- **Running two versions at once is not supported.** The two builds request Electron's single-instance lock under different product names, so the old app does not stop the new one from starting. Protection is per profile, by the lock file. Concurrent edits of the same profile settings from both windows are last-writer-wins.
- **The old version cannot be changed.** It does not know the new version's ownership token. It still honors the shared lock file and the owner-process check.
- **No atomic rollback.** The installer replaces program files. It does not snapshot user data. A failed or interrupted install leaves user data as it was, as tested. Program files may be in either version's state, and re-running either installer repairs them.

## Downgrade policy

- **This path:** schemas are identical, so the old version can open data the new version used.
- **Settings the old version does not know** are ignored when it reads them. For example, Device Identity presets fall back to *Match this computer*, and bookmarks imported with the new feature remain in Chrome's own file.
- **Future schema changes:** `migrate()` copies `profiles.db` to `profiles.db.<timestamp>.bak` before applying any migration (`server/migrations.js`). A build that finds a schema version newer than it knows now refuses to start, with "This data was written by a newer version of AZWAH…", and changes nothing (`SCHEMA_TOO_NEW`, `test/migrations-newer-schema.test.js`). Builds released before this guard cannot refuse. To go back after a schema change, restore the `.bak` copy taken just before the migration, with all AZWAH windows closed.

## Cookie import found during qualification

The gate showed that a cookie imported by the old version into a stopped Chrome Stable profile is discarded the first time Chrome runs that profile. The old importer encrypted it with the stock Chromium key, which Chrome Stable on Windows cannot read. This happened entirely within the old version, before any upgrade. The new version imports through Chrome itself, and the gate checks that Chrome reads it after the upgrade.

## Still outstanding (physical clients)

CI does not cover:
- an upgrade on a physical Windows 10 or 11 PC from that user's real previous version and data;
- interactive installer prompts (close-app dialog, SmartScreen, Defender);
- a standard (non-admin) account with redirected folders.

Use `docs/windows-client-qualification.md`, section A, with a disposable copy of the data folder. Never test against real profile data.
