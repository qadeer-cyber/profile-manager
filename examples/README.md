# Local automation examples

Profile Manager exposes `http://127.0.0.1:3000/api/v1` when you run it locally. Requests need `Authorization: Bearer <token>` or `X-API-Key`. The token is the desktop app's API token or `PM_API_TOKEN`.

CDP is off unless the profile has automation enabled or the launch body sets `"automation": true`. The debugging port binds to loopback only. These examples refuse any CDP URL whose host is not `127.0.0.1` or `localhost`.

## Node.js

```bash
PM_API_TOKEN=... PROFILE_ID=... node examples/playwright-cdp.mjs
```

`examples/playwright-cdp.mjs` launches the profile with automation, checks the endpoint, connects Playwright with `connectOverCDP`, opens a page, disconnects, and stops the profile.

## Python

```bash
pip install playwright
playwright install chromium
PM_API_TOKEN=... PROFILE_ID=... python3 examples/playwright-connect.py
```

`examples/playwright-connect.py` uses the standard library for the API call and `playwright.sync_api` `connect_over_cdp` for the browser. Missing `PM_API_TOKEN` or `PROFILE_ID` exits 2 before importing Playwright.

## Encrypted backups

The optional encrypted backup format is documented in `server/backup-crypto.js`. It is AES-256-GCM with scrypt (N=16384, r=8, p=1). Older `PMB1` backups restore without a passphrase. The passphrase is sent in the JSON body when creating a backup and in the `X-Backup-Passphrase` header when restoring. It is not accepted in the query string.
