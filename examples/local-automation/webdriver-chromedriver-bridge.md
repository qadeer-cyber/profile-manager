# WebDriver bridge (Chromium automation + optional driver cache)

Manual **native** profile starts do **not** open CDP. WebDriver attach works only when the profile runs on the **automation path** (`automation: true` on launch or automation enabled on the profile).

## ChromeDriver sources (pick one)

| Source | Notes |
|--------|--------|
| **Opt-in cache** (recommended) | Settings → enable automation driver cache → **Download ChromeDriver**. Verified CfT build matching pinned Chromium. |
| `PM_CHROMEDRIVER_PATH` | Point at your own chromedriver executable. |
| PATH | Stock chromedriver on PATH (you must match Chromium version). |

ChromeDriver is **not** bundled in the offline NSIS installer.

## Steps

1. Launch with automation:
   - `POST /api/v1/profiles/:id/launch` with `{ "automation": true }`
   - `GET /api/v1/profiles/:id` → `cdp.debuggerAddress`

2. Start the local bridge:
   - `POST /api/v1/profiles/:id/webdriver/start`
   - Response: `webdriverUrl`, `sessionHint.goog:chromeOptions.debuggerAddress`

3. Selenium: point at `webdriverUrl` and pass `debuggerAddress` (see `examples/selenium_attach.py`).

4. Cleanup: `POST /api/v1/profiles/:id/webdriver/stop`, then stop the profile.

See also: `docs/handoff/multilogin-platform/AUTOMATION_DRIVERS.md`, `examples/local-automation/geckodriver-firefox-bridge.md` (Firefox).

No CAPTCHA bypass.
