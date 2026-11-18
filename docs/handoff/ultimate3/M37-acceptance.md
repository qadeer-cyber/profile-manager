# M37 — Selenium / WebDriver

**Status: PARTIAL**

## What passed

- `webDriverNewSessionBody` builds `goog:chromeOptions.debuggerAddress` and rejects a malformed address before ChromeDriver is spawned.
- The bridge report sets `fullParity: false`.
- The stub ChromeDriver path still creates a session with that body, navigates, and reads the URL (`test/webdriver-bridge.test.js`, `test/webdriver-api.test.js`).
- `test/webdriver-real.test.js` adds `GET /window/rect` after title, on the same real create / navigate / element / unicode value / two-profile isolation / quit flow.

## Gap (why not VERIFIED)

`PM_REAL_WEBDRIVER` was not set on this host, and ChromeDriver was not exercised against the pinned Chromium. The real-path test stays skipped. A stub session is not full WebDriver parity. Firefox remains the separate `PM_REAL_GECKODRIVER=1` opt-in and was not run either.

```bash
PM_REAL_WEBDRIVER=1 PM_CHROMEDRIVER_PATH=/path/to/chromedriver npm run test:webdriver:real
```
