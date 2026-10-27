# Development

Node.js 22. The lockfile is `package-lock.json`. Use `npm ci`, not a floating install.

```bash
npm ci
npx playwright install chromium
npm run build          # Vite, output web/dist
npm run dev:web        # Vite dev server
npm run dev:api        # Express only
npm start              # build, then server/index.js
npm run app            # build, then Electron
```

## Test commands

`npm test` builds the UI, then runs unit, desktop, API, engine, proxies, security, and UI smoke. It does not run `test:electron` or the offline installer smoke.

| Script | What it runs |
|---|---|
| `npm run test:unit` | `test/unit.test.js`, `app-security.test.js`, `shutdown-ack.test.js`, `shutdown-durable.test.js`, `testflags.test.js` |
| `npm run test:desktop` | `test/desktop-unit.test.js`, then `test/desktop-engine.e2e.js` |
| `npm run test:api` | `test/api.e2e.js` under `PM_AUTOMATION_DEFAULT=1` |
| `npm run test:engine` | `test/engine.e2e.js` under the same flag |
| `npm run test:proxies` | `test/proxy-library.e2e.js` |
| `npm run test:security` | `test/security.e2e.js` and `test/security-migration.e2e.js` |
| `npm run test:ui` | `test/ui-smoke.run.js` |
| `npm run test:electron` | standard desktop smoke, `test/electron-smoke.js` |

`node --test` is the runner. `mock.module` needs `--experimental-test-module-mocks` (already on `test:unit`). Shutdown-ack tests run with `concurrency: false`. API and engine suites need the Playwright Chromium install.

On Windows CI the Node suites run first, while `better-sqlite3` still has its Node prebuild. `node scripts/confirm-node-native.mjs` checks that. The workflow then deletes `node_modules/better-sqlite3/prebuilds` and runs `npx electron-builder install-app-deps` so `build/Release/better_sqlite3.node` is the Electron ABI, and only then runs `npm run test:electron`. Leaving the prebuild in place makes that rebuild a no-op.

`test/electron-smoke-offline.js` is not part of `npm test`. It runs on Windows against the installed offline exe, and only from the installer job. It refuses to run on any other platform.

Counts from the green dispatch of commit `be575c7` are in [README.md](README.md).

## Operator environment

Copy `.env.example` if you want a reminder. The process does not load a `.env` file by itself. Export the variables, or set them in the shell that starts Node or Electron.

| Variable | Who reads it | Default |
|---|---|---|
| `HOST`, `PORT` | `server/app.js` `startServer` | `127.0.0.1`, `3000` |
| `PM_DATA_DIR` | `server/db.js` | `./data` |
| `PM_USER_DATA` | `electron/main.js` | Electron `userData` |
| `PM_API_TOKEN` | `server/secrets.js` | file `api-token` in the data dir |
| `PM_SECRET` | `server/secrets.js` | file `secret.key` in the data dir |
| `HEADLESS` | settings default when `1` | setting `defaultHeadless` |
| `PROXY_TEST_URL` | proxy test target | `https://api.ipify.org?format=json` |
| `PM_PROXY_TEST_TIMEOUT_MS` | proxy test | `10000` |
| `PM_HEALTH_INTERVAL` | health monitor | `3000` |
| `PM_SHUTDOWN_TIMEOUT_MS` | CLI durable shutdown | `20000` |

`PM_AUTOMATION_DEFAULT`, `PM_PROXY_LOOPBACK`, and `PM_PROXY_TEST_INSECURE_TLS` are dev and test switches. In `server/` their names appear only in `server/testflags.js`. A packaged app sets `PM_PACKAGED=1` and ignores them. Do not document them as user settings.

`PM_SMOKE` and `PM_SMOKE_OFFLINE` start the in-app smoke. They are not a way to load a path from the environment. The offline smoke import is a literal relative path.

## Local Windows offline package

```bash
npm run dist:win:offline
```

That script builds the UI, runs `node scripts/fetch-bundled-chromium.mjs win64`, then:

```text
electron-builder --config electron-builder.offline.cjs --win nsis --x64 --publish never
```

`--publish never` is required. Without it, electron-builder on CI tries to publish and fails because `GH_TOKEN` is not set. Do not add a token to make publish succeed.

## Ignore rules

`.gitignore` ignores `data/`, `dist/`, `node_modules/`, `release/`, `web/dist/`, and `build/bundled-browsers/`. It does not ignore `.env`, `*.pem`, `*.pfx`, a `*.db` outside `data/`, or `screenshot.png`. None of those are tracked. Do not add them.

`electron/offline-smoke.js` must not contain a PEM private key. `test/shutdown-durable.test.js` asserts that. The offline smoke generates its bad certificate at runtime under the temp directory and passes only `PM_SMOKE_TLS_PORT`.
