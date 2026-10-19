# Prioritized Engineering Backlog — Profile Manager parity

- **Baseline:** `d7a000eeadd4f4645a608a1e0cc2b8ad154a75d9` (frozen M1). **Directive:** `MASTER_DIRECTIVE.md` @ `ecf4aed` (§18 C, §19 steps 3–4).
- **Source:** `FEATURE_PARITY_MATRIX.md` (row IDs are cited below).
- **Approval:** this is read-only analysis. Every item needs owner approval before implementation (§19 step 5). M3, M4 and M5 items each need reapproval of the historical milestone.
- **Out of this backlog:**
  - Fingerprint/spoofing rows B1.2 and B6–B14, which stay research-only and need a separate proposal.
  - **OWNER-DECLINED (2026-10-19), no development:** D3 pre-made cookie packs/CookieRobot and F10 human-typing simulation.
  - Teams/cloud and commercial proxies (Module H, C6, C7, D8, D9), which are blocked on an external service.
- **Size scale:** S ≈ <150 LOC, M ≈ 150–500, L ≈ 500–1200, XL > 1200. Each size covers code plus its tests.

## Ranking criteria
1. User-facing value for everyday local profile work.
2. Low risk to M1 lifecycle, encryption formats and app identity.
3. It can be verified locally with real Chromium tests.
4. It unblocks other rows.

## Backlog

| # | Item (matrix rows) | Value | Files / components (est.) | Size | Depends on | Key risks |
|---|---|---|---|---|---|---|
| 1 | **[P1 — preferred next candidate; BLOCKED until M2 integration + separate approval] Trash bin + folder entities + ID/copy-ID + extra columns** (A6.5, A5.6, A6.1, A1.4, A5.8, A2.1) | High: deletes are irreversible today, and folders can't be created, renamed or deleted | `server/migrations.js` (v8: `folders` table, `profiles.deleted_at`, `folder_id`, keeping the `folder` string for compatibility); `server/app.js` (`remove`→trash, restore, purge, folder CRUD, `list` excludes trashed); `web/src/App.jsx` sidebar; `ProfilesPage.jsx` (Trash view, ID/created/last-used columns, copy IDs); new `web/src/pages/TrashPage.jsx`; tests: `test/organization.e2e.js` (new), `unit.test.js` migration cases, `ui-smoke.mjs` steps | L | none | Migration on real M1 DBs: must be additive and tested against `test/fixtures/schema-v0.4.0.mjs`. Trashed profiles keep sessions on disk, so the retention/privacy notice must be clear. Purge has to keep the existing stop→rm ordering. |
| 2 | **[P2 — acceptance criteria only; default settings-only] Clone dialog + batch clone + explicit storage mode** (A4.1, A4.2, A4.3, A5.7) | High: the UI always copies data, which differs from Multilogin's settings-only default | `server/app.js` `clone()` (count ≤10, name pattern, folder, proxyId override, all-or-nothing cleanup); new `web/src/components/CloneDialog.jsx`; `ProfilesPage.jsx` row and bulk actions; tests in `api.e2e.js` / new `test/clone.e2e.js` | M | Default decided: settings-only (2026-10-19) | Partial batch failure must leave no orphaned dirs. Copy-with-data must keep refusing running/settling profiles. |
| 3 | **[P3 — secure API + storage design only] Cookie import/export (JSON + Netscape), stopped-profile, UI + v1** (D1, D2, F9) | High: core Multilogin session workflow | new `server/cookies.js` (parse, validate, normalize); `server/app.js` routes `/profiles/:id/cookies/{import,export}` on `/api` and `/api/v1`; use of engine lock in `server/browsers.js` (headless short-lived context on a stopped profile only, with no M1 classifier changes); new `web/src/components/CookieDialog.jsx`; tests: `test/cookies.e2e.js` (new), `unit.test.js` parser cases | L | none (uses existing launch/lock primitives) | Sensitive auth data: no logging, explicit consent, warn on export. Writing must never touch an active DB. A temporary launch must not emit user-visible lifecycle Error events. |
| 4 | Per-profile startup URLs (≤10) + restore option (A1.11) | Med-High | migration column `start_urls`; `doLaunch` in `server/app.js`; `ProfileDialog.jsx` (new Browser tab); test in `api.e2e.js` | S–M | none | URL validation. Restore relies on Chromium session restore, so verify it before claiming it. |
| 5 | Bulk proxy assignment + bulk create UI from CSV/JSON with preview, progress, cancel (A5.1, A5.2, A5.4) | Med-High | `server/app.js` (`/bulk/assign-proxy`, CSV parser, per-row results); `web/src/lib.js` `runAll` cancellation; new `BulkImportDialog.jsx`; tests `test/bulk.e2e.js` | M–L | #1 (folders) helpful | CSV injection on round-trip; partial failure isolation (§14 case 14) |
| 6 | Profile templates (A1.10) | Med | migration `templates` table; routes; `TemplatesPage.jsx`; editor "from template" | M | #4 | Templates must reference proxies by ID only and never carry secrets |
| 7 | Tag entities with colours, multi-tag any-of filter, tag manager (A1.5, A2.3) | Med | migration `tags` table (keep JSON array readable); `/api/meta`; `ProfilesPage.jsx` filter | M | #1 | Back-compatibility with existing JSON tags |
| 8 | Proxy library: CSV/JSON import with preview, non-secret export, proxy lists with sequential/random assignment (C3.2, C2.2, C5) | Med | `importProxies`/`parseProxyLine`; `ProxiesPage.jsx` | M | — | Never export passwords by default |
| 9 | Profile export/import (versioned encrypted archive) + user backup/restore (D5, D6, D7) | Med-High (larger) | new `server/archive.js`, `server/backup.js`; SQLite online backup API; `StorageBackupsPage.jsx`; traversal tests | XL | #1, #3 | Path traversal, zip bombs. safeStorage secrets aren't portable. Never restore over a live DB. |
| 10 | Running-profiles window controls + per-launch headless + restart (A2.10, A3.7, A3.2) | Med | `server/browsers.js` (pipe CDP `Browser.getWindowForTarget/setWindowBounds`, no new port); `ProfilesPage.jsx` | M | — | Restart must reuse stop→launch through the M1 classifier, not replace it |
| 11 | Pagination/virtualization + N+1 fix in `row2p` (A2.6) + perf baseline (§16) | Med (grows with scale) | `server/app.js` `list` JOIN; `ProfilesPage.jsx` windowed rows | M | — | Must keep the current sort/filter behaviour |
| 12 | Accessibility + dashboard (G2, G10, A2.8 context menu) | Med | `App.jsx`, new `DashboardPage.jsx`, `ContextMenu.jsx`; axe/keyboard tests in `ui-smoke.mjs` | L | #1–#3 (actions to expose) | Every menu item must be wired to a tested action |
| 13 | M3 timezone/locale/languages (B2, B3) | Med | `server/browsers.js` launch options; editor Browser tab; observation via DiagnosticsV1 | M | M2 accepted; **M3 reapproval** | 'Masked'/auto-from-proxy needs a legitimate geo source |
| 14 | M4 WebRTC policy (B5.2) | Med | launch args allowlist; editor | S–M | M2; **M4 reapproval** | Breaks calls; no anti-leak guarantee |
| 15 | M5 per-profile extensions (E1–E4, G6) | Med-High | `server/extensions.js`, migration, launch arg changes (`ignoreDefaultArgs: ['--disable-extensions']` per profile) | L | **M5 reapproval** | Untrusted code; storage corruption; must not change zero-extension launches |
| 16 | Selenium/Python example qualification + CLI (F5, F6, F7) | Low-Med | run `examples/selenium_attach.py` in CI; Python Playwright example; `bin/pm-cli.mjs` | S–M | — | Token handling in the CLI |
| 17 | Geolocation permission modes + user coordinates (B4.1, B4.2 custom only) | Low-Med | launch permissions; editor | S–M | owner approval | No hidden auto-grants |

## Owner packet decisions (2026-10-19)

Nothing below is authorized for implementation. Each packet still needs its own owner approval and must follow the §13 pipeline.

### Packet P1: Organization and safe deletion — PREFERRED NEXT CANDIDATE, BLOCKED
- **Status:** preferred next candidate. **Blocked** until M2 is integrated and separately approved. It shares `server/app.js` with M2, and the rule is one writer per file.
- **Scope (unchanged):**
  - Profile trash bin: move, restore, empty, permanent delete with confirmation, bulk ≤100.
  - Folder entities: create (including empty), rename, delete with a move-to-trash choice, optional note.
  - Profile ID column and copy one or many IDs.
  - Created and last-used columns.
  - Additive only. No lifecycle, encryption, proxy or identity changes.
- **Files:** `server/migrations.js` (v8), `server/app.js` (`remove`, `list`, trash and folder routes on `/api`, mirrored on `/api/v1`), `web/src/App.jsx`, `web/src/pages/ProfilesPage.jsx`, new `web/src/pages/TrashPage.jsx`.
- **Tests:**
  - New `test/organization.e2e.js`: trash keeps the user-data dir; restore relaunches with cookies intact; purge removes the dir; trashed profiles are hidden from list, meta and v1; launching a trashed profile returns 409/404; folder rename propagates; deleting a folder trashes its profiles.
  - `unit.test.js`: migration v8 on the v0.4.0 fixture plus a backup.
  - `ui-smoke.mjs` steps.
  - The unchanged M1 suites pass.
- **Risks:**
  - Migration on real user databases: needs a Windows upgrade check at the installer gate.
  - Sessions kept in trash are a retention/privacy issue, so the wording must be clear.

### Packet P2: Explicit clone workflow — ACCEPTANCE CRITERIA ONLY
**Owner decision:** the default is **settings-only** (fresh storage). **Copy-with-data** is an explicit choice. No implementation is authorized. These criteria only define "done" for a future approved packet.

**Acceptance criteria**
1. **Default mode.** The clone dialog opens with "Settings only (fresh storage)" selected. Copy-with-data needs a deliberate selection.
   - The API default must also become settings-only. Today `copyData` defaults to true, so that is a documented behaviour change, and existing `/api/v1` callers must be told.
2. **Session warning.** When copy-with-data is chosen, the UI states plainly that the clone will **share the source profile's logged-in sessions** (cookies, saved logins, site storage), so both profiles can act as the same signed-in user.
   - The user must confirm before cloning.
3. **Settings-only content.** A settings-only clone copies name pattern, tags, folder, notes, proxy reference and the automation flag. It has no cookies, history, localStorage or IndexedDB from the source.
4. **Source must be fully stopped (Windows).** Copy-with-data starts only after the source browser process has fully exited and the profile lock is released. Chromium holds `Cookies`, `History` and other SQLite files open while running.
   - It requires `isRunning` false, a dead recorded PID (`isAlive`/`pidMatches`) and no live lock owner (`readLock`). Otherwise it returns 409.
   - The source lock is held for the whole copy, so a source launch mid-copy returns 409.
5. **Include `Local State` (Windows).** Copy-with-data includes the top-level `Local State` file. It holds the `os_crypt` cookie-encryption key, which is DPAPI-protected per Windows user. Without it, the copied `Cookies` can't be decrypted.
   - A copied profile is usable only by the same Windows user on the same machine. The UI and docs must not promise portability.
6. **Exclusions.**
   - Never copied: the app lockfile, `SingletonLock`, `SingletonCookie`, `SingletonSocket`, `DevToolsActivePort`.
   - Caches, also never copied: `Cache`, `Code Cache`, `GPUCache`, the Dawn/Graphite/shader caches, `Service Worker/CacheStorage`, `Crashpad`, `*.tmp`.
   - Exclusions match at any directory depth.
7. **Cloned cookies actually load.** After a copy-with-data clone, launching the **new** profile through the normal M1 lifecycle path shows the source's test cookie and localStorage value in the browser. A file-level check alone doesn't pass. The cloned `Cookies` database also passes `PRAGMA integrity_check`.
8. **Source unchanged.**
   - After either mode, the source profile's DB row, proxy assignment and user-data directory are unchanged (hash/mtime listing of non-cache files before and after).
   - The source relaunches Stopped→Running with no `last_error`.
   - Writes made in the clone don't appear in the source.
9. **Batch and failure.** 1–10 copies, name pattern, target folder and optional proxy override. A failure or cancel at any point removes every partial row and directory (all-or-nothing).
10. **Regression.** The M1 lifecycle suites and §14 case 10 pass unchanged.
    - Exit/lock and exclusion tests run on the Windows workflow. Adding that step is a CI change that needs owner approval.

### Packet P3: Cookie import/export — SECURE API + STORAGE DESIGN ONLY
**Owner decision:** design only. No implementation.

**API design (both `/api` and token-auth `/api/v1`)**
- `POST /profiles/:id/cookies/export` takes `{ format: "json"|"netscape", domains?: string[], acknowledgeSessionExposure: true }`.
  - Without `acknowledgeSessionExposure: true` the server returns 428 and exports nothing.
  - The UI shows an **explicit warning before export**: the file contains session tokens that give access to signed-in accounts, so the user should store it securely and never share it.
- **User-chosen destination.** In the desktop app the user picks the save path in a native save dialog (Electron main via a narrow preload method). The server never picks or remembers a location. Over `/api/v1` the cookies are returned only in the response body to the authenticated caller.
- `POST /profiles/:id/cookies/import` takes `{ format, data, overwrite: "skip"|"replace", confirmOverwrite: true }` and returns per-cookie results with **no cookie values**.
- **Values never logged or echoed.** Cookie values (and names where sensitive) never appear in logs, SSE events, `last_error`, API error bodies or toasts. Errors refer to cookies by index/domain only.
  - A test seeds a sentinel value and asserts it's absent from every log and error.

**Import validation (reject the whole request, write nothing)**
- Oversized input: the cap is a design decision, proposed 5 MB and 10,000 cookies. Over the cap returns 413.
- Malformed input: invalid JSON or Netscape lines, missing name/domain/path, non-numeric expiry, a value with a bad type, unknown `sameSite`. These return 400 with the row index.
- Mismatched domains: if the user restricts the import to domains, any cookie outside them is rejected. Also rejected: public-suffix-only domains, IP/host mismatches, and leading-dot inconsistencies.
- Invalid `__Host-` cookies: rejected unless `secure=true`, `path="/"` and no `domain` attribute (host-only). `__Secure-` cookies are rejected unless `secure=true`.
- `sameSite=None` without `secure` is rejected. Expired cookies are skipped and reported.

**Storage/engine approach (SWE's method)**
- Never read or write the `Cookies` SQLite file directly. On Windows its values are encrypted with the DPAPI-protected key in `Local State`.
- Import/export requires a **stopped** profile (409 otherwise). The server launches it **headless and offline** through the existing M1 lifecycle path (`engine.launch`, same lock, same classifier). Proxy is disabled and network access blocked for that session. It then calls Playwright `context.addCookies()` or `context.cookies()`, stops through `engine.stop`, and confirms Stopped with no `last_error`.
- The temporary session isn't shown as a user launch. It's tagged internally so the UI doesn't flash Running, and it never changes classifier semantics.
- Tests (design):
  - Round-trip JSON and Netscape.
  - Imported cookies visible in a later normal launch.
  - Profile B unaffected.
  - Each rejection class above.
  - No network egress during the offline session.
  - No sentinel value in logs or errors.
  - The M1 suites unchanged.

### OWNER-DECLINED (no development)
- Pre-made cookie packs / CookieRobot-style warm-up (matrix D3).
- Human-typing simulation (matrix F10).

## Notes
- Every packet must follow the §13 pipeline and §14 packet reporting. Installer workflow dispatch needs separate approval.
- Matrix row counts: see the `FEATURE_PARITY_MATRIX.md` scorecard (122 rows; A3.3 split into A3.3a/A3.3b; A1.12b and F2b split out for loopback binding).
