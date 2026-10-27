# Architecture

Profile Manager is one Node process. The desktop shell and the CLI server share `server/`. The React UI is a static build loaded by Electron or by Express.

## Processes

| Piece | Path | Role |
|---|---|---|
| Electron main | `electron/main.js` | Window, single-instance lock, user-data path, browser path, packaged flag, quit |
| Preload | `electron/preload.cjs` | `contextIsolation` bridge `window.pm`: UI token, open data folder, app info, events |
| Offline smoke | `electron/offline-smoke.js` | Loaded only when `PM_SMOKE=1` and `PM_SMOKE_OFFLINE=1`, by a literal `import('./offline-smoke.js')` |
| HTTP app | `server/app.js` | Express routes for the UI (`/api`) and the automation API (`/api/v1`) |
| CLI | `server/index.js` | `npm start` / `npm run dev:api`. Listens on `127.0.0.1:3000` unless `HOST` or `PORT` is set |
| Engine | `server/browsers.js` | Launch, stop, locks, health monitor, CDP |
| Chromium pin | `server/chromium.js`, `server/chromium-manifest.json` | Download, checksum, and install-root rules |
| Database | `server/db.js`, `server/migrations.js` | SQLite file `profiles.db` |
| Secrets | `server/secrets.js` | Proxy passwords and the API token |
| Shutdown | `server/shutdown.js` | Browser close, then `wal_checkpoint(TRUNCATE)`, then `db.close()` |
| Test flags | `server/testflags.js` | The only `server/` file that names the three dev switches |
| UI | `web/src` | Vite + React. Icons are drawn in `web/src/components/Icon.jsx`. There is no separate image asset |

`electron/main.js` sets `PM_PACKAGED` from `app.isPackaged` before it dynamically imports `server/app.js`. The window uses `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. Navigation away from the app is blocked. External links open in the system browser. Permission requests are denied.

## Data directories

Electron's `userData` path uses the package name `profile-manager` (`package.json` `"name"`). The product name `Profile Manager` is only the installer and shortcut name.

| What | Where |
|---|---|
| Desktop user data | `%APPDATA%\profile-manager` (or `PM_USER_DATA`) |
| Database and profiles | `<userData>/data/profiles.db` and `<userData>/data/profiles/<uuid>/` |
| Key and API token | `<userData>/data/secret.key`, `<userData>/data/api-token` |
| Log | `<userData>/logs/main.log` |
| Downloaded Chromium (no bundle) | `<userData>/browsers` |
| Bundled Chromium | `<install>\resources\browsers\chromium-1248` and `chromium_headless_shell-1248` |
| Per-user install | `%LOCALAPPDATA%\Programs\Profile Manager\` |

Web mode (`node server/index.js`) uses `PM_DATA_DIR` or `./data`. `server/db.js` opens the database at import time, so `electron/main.js` must set `PM_DATA_DIR` before that module loads. It is not a static import of `server/db.js`.

Browser path in `electron/main.js`, in order:

1. `PM_BROWSERS_PATH`, copied onto `PLAYWRIGHT_BROWSERS_PATH`.
2. A packaged app whose `resources/browsers` contains a `chromium-<revision>` directory uses that directory.
3. A packaged app with no bundle uses `<userData>/browsers`.
4. Development uses Playwright's own cache.

`installOne` refuses to download into a `resources/browsers` root (`BAD_INSTALL_ROOT`). `POST /api/browser/install` returns `ALREADY_INSTALLED` when Chromium is already present and the caller did not inject an installer.

The pinned browser is Playwright core 1.64.1, revision 1248, Chrome for Testing 156.0.8078.4, from `https://cdn.playwright.dev`. Archives are checked with the SHA-256 values in `server/chromium-manifest.json` before extraction.

## SQLite

`better-sqlite3` 13. WAL mode, `foreign_keys=ON`, `busy_timeout=5000`, `secure_delete=ON`. Schema version lives in `schema_version`. Migrations in `server/migrations.js` run in order, each in its own transaction:

| Version | Change |
|---|---|
| 1 | `profiles` |
| 2 | `running` |
| 3 | `settings` |
| 4 | `last_launched_at`, `last_error`, folder index |
| 5 | `profiles.automation_enabled` default 0 |
| 6 | `proxies` library, `profiles.proxy_id`, inline proxies copied into library rows |

Node 22 loads the Node prebuild (modules ABI 127). The packaged app loads the Electron 44 rebuild (modules ABI 149) from `better_sqlite3.node`. electron-builder `asarUnpack` includes `**/*.node`. Electron may report the virtual `app.asar` path; the unpacked file is the sibling path with `app.asar` replaced by `app.asar.unpacked`. Prebuilds are excluded from the packaged `files` list.

## Launch and CDP

`automationEnabled` is `!!opts.automation || automationDefault()`. `automationDefault()` is true only when the process is not packaged and `PM_AUTOMATION_DEFAULT=1`.

A normal launch does not add `--remote-debugging-port`. Playwright may still add `--remote-debugging-pipe` for its own control channel. That pipe is not a CDP port.

An explicit `automationEnabled` profile, or `POST /api/v1/profiles/:id/launch` with `{"automation": true}`, binds CDP to `127.0.0.1` and returns `cdp.debuggerAddress`. The UI launch route does not accept an override.

## Proxies and loopback

HTTP, HTTPS, and SOCKS5. A proxy with a username is wrapped by a local no-auth relay (`proxy-chain`) because Chromium will not authenticate SOCKS itself. Passwords are stored as `ss:v1:` (Electron `safeStorage`) or `enc:v1:` (AES-256-GCM from `PM_SECRET` or `secret.key`). After startup re-encryption, `decrypt()` rejects a value with neither prefix.

`PM_PROXY_LOOPBACK=1` is honored only when the app is not packaged. It appends `--proxy-bypass-list=<-loopback>`, which sends loopback through the proxy instead of around it. A packaged build ignores that variable, so this repository does not add the switch. A proxied launch of the installed app still has exactly one `--proxy-bypass-list=<-loopback>` argument, and loopback traffic reaches the proxy. The offline smoke requires that count.

`PM_PROXY_TEST_INSECURE_TLS=1` sets `rejectUnauthorized: false` on the proxy test agent only when the app is not packaged. A packaged build keeps certificate verification on.

## Shutdown

Windows `child.kill('SIGTERM')` is `TerminateProcess`. Signal handlers in `server/index.js` do not run. Parents that fork the server (`test/_ports.mjs`) send IPC `{type:'shutdown'}` or the string `'shutdown'`, with `execArgv: []` and an IPC channel.

`durableShutdown` closes browsers, then `wal_checkpoint(TRUNCATE)`, then `db.close()`. Both the checkpoint and the close must succeed. The CLI then sends `{type:'shutdown-done'}` and exits 0. `process.send` returning false is backpressure, not a failed callback; the ack waits for the callback, with a 5 second timer. A failed checkpoint or close logs, exits 1, and sends no ack. The harness treats a missing ack within 15 seconds as a failed test and then hard-kills.

Electron `before-quit` sets `quitStarted` and then calls `preventDefault` once. It runs the same `durableShutdown` with a 10 second cap. Success calls `app.exit(0)`. A throw or the cap calls `app.exit(1)`. A second `before-quit` returns without `preventDefault`.

## HTTP surface

UI routes under `/api` require `X-UI-Token` in the desktop app. `?token=` is rejected. `/api/v1` accepts `Authorization: Bearer` or `X-API-Key`. Both surfaces share the proxy library routes. Passwords are not returned. `POST /api/v1/profiles/:id/launch` is the only launch route that accepts an `automation` override.

The UI is Profiles, Proxies, Settings, and Diagnostics (`web/src/App.jsx`). A missing Chromium build shows a banner with **Download Chromium**, except on the Diagnostics page.
