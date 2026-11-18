# Automation drivers (ChromeDriver / geckodriver)

**Status:** optional user cache — **not** bundled in the offline NSIS installer.

| Driver | Source | License | Pin |
|--------|--------|---------|-----|
| ChromeDriver | Chrome for Testing via `cdn.playwright.dev` (same browser version as `server/chromium-manifest.json`) | Google CfT terms | SHA-256 in manifest |
| geckodriver | [Mozilla release v0.36.0](https://github.com/mozilla/geckodriver/releases) | MPL-2.0 | `server/geckodriver-manifest.json` |

## User flow

1. Settings → enable **automation driver cache** (opt-in) → Save.
2. Click **Download ChromeDriver** / **Download geckodriver** (calls `POST /api/automation-drivers/install` with `confirm: true`).
3. Files land under `<PM_DATA_DIR>/automation-drivers/`.
4. WebDriver bridges resolve: `PM_*_PATH` env → cached path setting → cached install → PATH.

## API

- `GET /api/automation-drivers` — report (no secrets)
- `POST /api/automation-drivers/install` — `{ driver: "chromedriver"|"geckodriver"|"both", confirm: true }`

## Honest limits

- Still **no** Selenium Server; localhost bridge only.
- Manual native launches cannot attach WebDriver.
- Preview installer §19 does **not** require bundling these into the EXE.
