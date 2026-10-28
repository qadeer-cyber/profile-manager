# Security and stability inspection — alpha.2 integrated tree

Inspection date: 2026-10-28. Host: Linux. No Windows process was available, so nothing below is a Windows pass.

## Checked in source

| Area | Result |
|---|---|
| Proxy passwords | Stored as `enc:v1:` or `ss:v1:` (`server/secrets.js`). API responses do not return the password. Startup re-encrypts unprefixed values, then `setStrictPrefixes(true)` rejects plaintext. |
| Provider account secrets | `encrypt()` before insert (`server/proxy-providers.js`). Public account objects expose `hasSecret` / `hasApiToken` only. |
| Diagnostics payloads | `Cache-Control: no-store`. Auth runs before profile lookup. Query-string tokens are not accepted. Proxy snapshot drops usernames, passwords, and local relay endpoints. |
| Cookie edits while a profile is running | `cookieMutation` returns 409 `PROFILE_RUNNING` for import and clear. |
| Backups | Passphrase in the query string is rejected. Encrypted backups are AES-256-GCM. An unencrypted backup includes `secret.key` by design so a restore can decrypt proxy secrets. That file is sensitive. |
| Migrations 10–12 | Additive tables and columns. They do not delete profile rows. `migrate()` copies `profiles.db` before applying pending versions. |
| Browser processes | Startup recovery removes a running row and a `.pm-lock` only when the recorded pid is dead or fails the command-line ownership check. A live matching browser is not cleared. |
| Startup exceptions | Electron logs `uncaughtException` / `unhandledRejection` to `%APPDATA%\profile-manager\logs\main.log` and restarts a dead backend at most three times. |
| Global `/api/diagnostics` | Still returns the data directory. The M2 contract says to leave that endpoint unchanged. The smoke script redacts user names and profile paths in evidence files. |

`npm ci` reported 3 dependency audit findings (1 moderate, 2 high). They were not upgraded in this pass. `npm audit fix` can move transitive packages and was not treated as a product fix.

## Defect fixed

| Id | Severity | Change |
|---|---|---|
| UI-PILL-CASE | P2 | `.pill` in `web/src/style.css` forces `text-transform: lowercase`. Diagnostics status chips use that class, so the rendered text was “versions match”, “version mismatch”, and “unavailable”. `web/src/diagnostics.css` now sets `.pd .pill { text-transform: none }`, which keeps the words the component already writes. Re-run of `web/e2e/diagnostics-ui.mjs`: 54 passed, 0 failed. |

No Linux-reproduced P0 or P1 was changed. The pill case is display-only. The underlying facts were already correct.

Open, not fixed here:

| Id | Severity | Why it was not changed |
|---|---|---|
| WIN-COOKIE-DPAPI | P1 for Windows cookie interoperability | Cookie values Chromium writes on Windows use DPAPI (often prefix `v10` with an OS-wrapped key). `decryptCookieValue` returns `unsupported_encryption` for a non-`peanuts` blob and does not invent plaintext. Implementing DPAPI here cannot be verified on Linux, and a wrong writer can corrupt `Cookies`. Scenario 11 of the smoke package records the actual behavior. |
| WIN-INSTALL | Release blocker | No Windows 10/11 install was run. Unsigned EXE. SmartScreen warning is expected. |
| WIN-TASKKILL | Release-only M2 case 5 | `taskkill /F` classification stays a Windows todo in `test/diagnostics.e2e.js`. |
| APP-HEALTH-POLL | Not a defect | The Diagnostics page polls `GET /api/diagnostics` and `GET /api/browser` every 2 seconds. That is application status. Profile observations are requested only from Refresh and from the consented environment action. |

Linux AES key-file fallback when OS secure storage is unavailable is the existing desktop behavior (`electron/main.js`). On Windows, `safeStorage` is DPAPI. Scenario 10 checks that with a real login session.

## Claims that stay forbidden

This tree does not support “undetectable fingerprint” or “zero WebRTC leak.” WebRTC diagnostics report an allowlisted command-line policy or an explicit unavailable fact. Effective policy and ICE candidates are not collected in M2.
