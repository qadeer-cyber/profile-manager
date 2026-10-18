> This repository branch is a **Windows validation candidate**, not the original signed-off v0.4.0 release. Existing cross-built EXEs remain in Google Drive; the Windows-native build must pass before being treated as release-ready.

# Profile Manager

A desktop browser profile manager (Electron + React + Express + SQLite + Playwright Chromium), written from scratch.
Each profile is an isolated Chromium user-data directory (its own cookies, localStorage, and cache), with an optional per-profile proxy and a local automation API.

## For users (Windows)
Pick one of the builds in `release/`:
- **`Profile Manager-Setup-<ver>-x64.exe`**: NSIS installer for the current user. You can choose the install folder, and it adds a desktop shortcut.
- **`Profile Manager-<ver>-x64-portable.exe`**: a single exe with no install.

The first time you start the app, open **Diagnostics → Download Chromium**. Chromium is downloaded once, about 170 MB, into `%APPDATA%\Profile Manager\browsers`. A banner reminds you until it's installed. Settings also lets you point the app at a Chromium or Chrome you already have.

User data lives in `%APPDATA%\Profile Manager\data`: `profiles.db`, `profiles\<id>\`, the key file, and the API token. Uninstalling keeps this folder.

The builds are **not code-signed**, so Windows SmartScreen will warn on first run.

## For developers
Requires **Node.js ≥ 22**. `better-sqlite3` is a native module: the Windows-native CI invokes `electron-builder install-app-deps`, and `build.npmRebuild` is enabled so its binary targets Electron on Windows. These compatibility steps still require a passing Windows runtime test.
```bash
npm install
npx playwright install chromium          # browser for dev / tests
npm run app                              # desktop app (Electron)
npm start                                # web mode: UI + API at http://127.0.0.1:3000
npm test                                 # unit + API e2e + engine e2e
npm run test:electron                    # Electron smoke test (uses xvfb-run on Linux automatically)
npm run dist:win                         # Windows NSIS + portable (on Linux this needs wine)
npm run dist:linux                       # unpacked Linux build (used for the packaged smoke test)
```

### Architecture
- `electron/main.js` runs the Express backend **in-process** on a random 127.0.0.1 port, guarded by a per-session UI token. The window loads it directly, so users never see localhost, ports, or npm.
  - The window uses `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
  - `electron/preload.cjs` exposes a small `window.pm` bridge: the token, open-data-folder, and events.
  - Navigation away from the app and new windows are blocked; external links open in the system browser.
  - All permission requests are denied, and a single-instance lock applies.
- `server/app.js` builds the Express app and the startup sequence: migrations, recovery, secret re-encryption, and the health monitor. `server/index.js` is the CLI entry for web mode.
- `server/browsers.js` is the engine: locks, launch and stop, crash detection, recovery, and shutdown.
- `server/lock.js` handles profile lock files. `server/proc.js` handles cross-platform process killing. `server/migrations.js` holds the schema migrations. `server/secrets.js` handles secret encryption.
- `web/src` is the React UI: sidebar (Profiles, Proxies, Settings, Diagnostics), searchable and filterable table, dialogs, and toasts.

### Chromium: downloaded on first run (chosen approach)
The installers do **not** bundle Chromium:
- **Pro:** the installer is about 120 MB instead of about 290 MB, and Chromium can be updated separately.
- **Con:** you need internet once.

Packaged builds set `PLAYWRIGHT_BROWSERS_PATH=<userData>/browsers` and run Playwright's own installer (`playwright-core/cli.js install chromium`, run with Electron as Node; unpacked from the asar). `GET /api/browser` reports the status, and `POST /api/browser/install` starts the download. Progress is shown on the Diagnostics page.

### Database migrations
- A `schema_version` table plus numbered migrations in `server/migrations.js`, applied in order. Each runs in its own transaction, and a failure rolls back without being recorded.
- Databases from earlier versions (with no `schema_version`) are adopted without data loss: the v1–v2 migrations use `IF NOT EXISTS`, and v4 only adds columns that are missing.
- v5 adds `profiles.automation_enabled INTEGER NOT NULL DEFAULT 0`, so existing profiles start with automation off.
- v6 adds the proxy library: a `proxies` table plus `profiles.proxy_id` (foreign key, `ON DELETE SET NULL`; `foreign_keys` is turned on). Inline profile proxies are moved into library rows with their ciphertext unchanged. Rows with an identical endpoint and stored password are merged, and the inline column is cleared.
- To add a migration, append `{ version: N, name, up(db) }`.

### Secrets
- **Desktop app:** proxy passwords are encrypted with **Electron safeStorage** (DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux) and stored as `ss:v1:…`. Older AES values are re-encrypted with safeStorage automatically at startup.
- **Fallback:** if safeStorage isn't usable (for example, Linux without a keyring, where Electron would only use `basic_text`), the app uses AES-256-GCM with `<data>/secret.key` or `PM_SECRET` (`enc:v1:…`). A warning is logged and shown in Settings and Diagnostics.
- **Strict prefixes:** at startup, any legacy plaintext secret is re-encrypted. After that, `decrypt()` rejects every stored value without an `enc:v1:` or `ss:v1:` prefix. It throws `UNPREFIXED_SECRET` and logs a warning that never includes the value. The profile then shows `secretError` and refuses to launch until the password is re-entered.
- Secrets encrypted with safeStorage can't be read by the web-mode server (`npm start`). Those profiles show a clear "re-enter password" error.

### Engine reliability
- **Profile lock:** `<profileDir>/.pm-lock` records `{ownerPid, browserPid, cdpPort, startedAt, host}` and is created atomically. If another live process holds it, you get a `409 "in use by another process"`. A lock whose owner is dead, or a corrupt lock file, is treated as stale and replaced.
- **Startup recovery:** clears running records and stale locks left by a crashed session. It kills an orphaned browser only if that browser's recorded CDP port still answers, which protects against killing an unrelated process that reused the pid.
- **Health monitor:** checks every 3 s (`PM_HEALTH_INTERVAL`), alongside Playwright's close event. If a browser dies on its own, the profile is marked stopped, `last_error` is set, the lock is released, and a `profile:crashed` event goes out (SSE `/api/events` in the browser UI, IPC in Electron, shown as a toast).
- **Safe shutdown:** on app quit or SIGTERM, each context is closed gracefully (5 s timeout), then the process tree is killed. Playwright's own signal handlers are turned off so they can't kill browsers before cookies and storage are written to disk.
- **Process tree kill:** Windows uses `taskkill /PID <pid> /T /F`. POSIX sends SIGTERM, then SIGKILL after a grace period.
- **Failed launches:** a bad executable gives `LAUNCH_FAILED` and a damaged data directory gives `CORRUPT_DIR`. Each comes with a clear message, and the profile is never left marked running or locked.
- **Concurrency and clones:** two simultaneous launches of the same profile start only one browser. A clone always gets a fresh directory, and lock files aren't copied. Cloning a running profile is refused with a `409` unless `copyData: false` is passed.

## Automation API (`/api/v1`)
Send the token as `Authorization: Bearer <token>` or `X-API-Key`.
- **Desktop app:** the token is in Settings → Automation API. The base URL changes each launch; see Diagnostics.
- **Web mode:** the token is in `data/api-token` or `PM_API_TOKEN`.

| Method | Path | Notes |
|---|---|---|
| GET/POST | /api/v1/profiles | List with `?q=&tag=&folder=`, or create `{name, tags?, folder?, notes?, proxy?}` |
| GET/DELETE | /api/v1/profiles/:id | |
| POST | /api/v1/profiles/:id/clone | `{name?, copyData?}` |
| PUT/PATCH | /api/v1/profiles/:id | Update (same fields as create, plus `automationEnabled`) |
| POST | /api/v1/profiles/:id/launch | `{headless?, url?, automation?}` returns `cdp: {wsEndpoint, httpEndpoint, debuggerAddress, pid}` |
| POST | /api/v1/profiles/:id/stop | |
| GET | /api/v1/running | |
| POST | /api/v1/bulk/create, /bulk/launch, /bulk/stop | Bulk create is all-or-nothing. Bulk launch returns a result for each profile |

**Automation flag:** every profile has `automationEnabled`, a boolean that defaults to `false`. It can be set on create and update, through both the UI API and `/api/v1`, and non-booleans return a 400.
- At launch, the effective value is passed to the engine as the `automation` option.
- `POST /api/v1/profiles/:id/launch` accepts a per-launch override, `{"automation": true|false}`, which takes precedence over the stored flag.
- The UI launch endpoint has no override and always uses the stored flag.

**UI token (desktop app):** the per-session token is accepted only in the `X-UI-Token` header. `?token=` in the query string is rejected with a 401.

**Proxy library:** reusable proxies with tags, a real test (external IP, latency, and a classified error), bulk text import, and per-profile assignment. Every route is available under both `/api` and `/api/v1`, and passwords are never returned. The full spec with examples is in [`docs/proxy-api.md`](docs/proxy-api.md).

Example scripts are in `examples/`: Playwright `connectOverCDP`, Puppeteer `connect`, Selenium `debuggerAddress`, and bulk curl. The UI API at `/api` adds settings (`/api/settings`), diagnostics, browser install, and events.

## Tests
| Suite | Command | What it covers |
|---|---|---|
| Unit + app (35) | `npm run test:unit` | header-only UI token, strict secret prefixes, automation flag and launch override (in-process, browser engine stubbed), plus migrations (fresh, legacy adoption, idempotence, rollback), locks (acquire, conflict, stale, corrupt, release), killTree (POSIX TERM→KILL; Windows `taskkill` arguments, mocked), secrets |
| API e2e (41) | `npm run test:api` | CRUD, search and filters, encryption, proxy test, socks5 login through the relay, CDP, clone rules, token check, bulk endpoints, Playwright and Puppeteer examples, restart, screenshot |
| Proxy library e2e (61 + 1 skipped) | `npm run test:proxies` | CRUD and validation, filters, real tests through local proxies (ok and every error code), PATCH semantics, assigning proxies to profiles, launching through a library proxy, delete 409 and force, import formats with masking, the `/api/v1` mirror, and checks that passwords never leak |
| Engine e2e (42) | `npm run test:engine` | upgrading a copy of a pre-migration DB, two profiles with separate cookies and localStorage, cross-instance locking, safe shutdown, data kept across restarts, clone not affecting the original, crash detection and its event, bad executable, corrupt directory, double launch, stale-lock and orphan recovery |
| Electron smoke (14 dev / 16 packaged) | `npm run test:electron`, or `PM_APP_EXE=release/linux-unpacked/profile-manager node test/electron-smoke.js` | real app under xvfb: token check, isolation and sandbox, rendered UI, launch, shutdown on quit, userData, migrations, encryption fallback, screenshots; the packaged run also covers the first-run Chromium download |
| safeStorage (2 runs) | `bash test/electron-safestorage.sh` | gnome-keyring over a private D-Bus session: first run uses the AES fallback, second run migrates the secret to safeStorage |

## Limitations / not verified
- **Windows 10/11 runtime is untested.** The installers were cross-built on Linux with wine but never run on Windows: the Windows `taskkill` path (only checked with a mock), DPAPI safeStorage, NSIS install and uninstall, the portable exe, and the first-run download on Windows.
- No code signing. No auto-update. No app icon (Electron's default is used).
- The Proxies page is a placeholder showing a read-only summary.
- Recovery can't verify lock owners from a different host (shared network drives); those locks are treated as held.
- Dev-only `npm audit`: 8 moderate findings in electron-builder's dependency chain (`sprintf-js` through `global-agent`). Production dependencies: 0 vulnerabilities.
