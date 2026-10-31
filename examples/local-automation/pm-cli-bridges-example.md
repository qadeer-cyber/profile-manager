# pm-cli automation bridge reports

Requires a running Profile Manager API (`PM_API_TOKEN`, optional `PM_API_BASE`).

```bash
export PM_API_TOKEN=your-token
npm run pm-cli -- bridges
npm run pm-cli -- config <profile-uuid>
```

- **bridges** — ChromeDriver and geckodriver localhost bridge status (not bundled in offline EXE; opt-in cache in Settings).
- **config** — Profile config v2 JSON with engine-specific warnings (Firefox gecko prefs, read-only cookies, etc.).

Launch with automation before starting a bridge:

```bash
npm run pm-cli -- launch <profile-uuid>
# Chromium: POST /api/v1/profiles/:id/webdriver/start
# Firefox: POST /api/v1/profiles/:id/geckodriver/start
```

See `webdriver-chromedriver-bridge.md` and `geckodriver-firefox-bridge.md` for Selenium session URLs.
