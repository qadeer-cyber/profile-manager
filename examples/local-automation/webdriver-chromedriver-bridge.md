# WebDriver bridge (automation launches only)

Manual **native** profile starts do **not** open CDP. WebDriver attach works only when the profile is running on the **Playwright automation path** (`automation: true` on launch or automation enabled on the profile).

1. Launch with automation and read CDP from the profile JSON:
   - `POST /api/v1/profiles/:id/launch` with `{ "automation": true }`
   - `GET /api/v1/profiles/:id` → `cdp.debuggerAddress`

2. Start the local ChromeDriver bridge (requires `chromedriver` on PATH or `PM_CHROMEDRIVER_PATH`):
   - `POST /api/v1/profiles/:id/webdriver/start`
   - Response includes `webdriverUrl` and `sessionHint.goog:chromeOptions.debuggerAddress`

3. Point Selenium at `webdriverUrl` and pass `debuggerAddress` in capabilities (see `examples/selenium_attach.py`).

4. `POST /api/v1/profiles/:id/webdriver/stop` when finished; stop the profile via the API when done.

No CAPTCHA bypass. ChromeDriver is **not** bundled; install a build matching pinned CfT Chromium.
