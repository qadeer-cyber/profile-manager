# Local automation examples

Requires Profile Manager API token (`PM_API_TOKEN` or desktop Settings).

Manual profile browsing uses **native spawn** and does not enable automation unless you pass `"automation": true` on launch (v1 API only).

| Example | Purpose |
|---------|---------|
| `cookie-robot-example.mjs` | Queue CookieRobot-local jobs (Chromium CDP only) |
| `gecko-cookies-export.mjs` | Read-only export of stopped **Firefox** `moz_cookies` (`PM_PROFILE_ID`) |
| `profile-config-example.mjs` | Profile config v2 schema + per-profile warnings |
| `pm-cli-bridges-example.md` | `pm-cli bridges` / `config` + bridge start flow |
| `npm run pm-cli -- help` | Full command list (profiles, workspaces, trash, proxy, cookies, diagnostics) |
| `npm run pm-cli -- bridges` | Print ChromeDriver + geckodriver bridge reports (requires token) |
| `webdriver-chromedriver-bridge.md` | Selenium + ChromeDriver bridge + **opt-in driver cache** |
| `geckodriver-firefox-bridge.md` | Firefox marionette + geckodriver cache |
| `puppeteer-cdp-attach.md` | CDP attach without WebDriver |

User-authorized navigation only; not for CAPTCHA abuse.
