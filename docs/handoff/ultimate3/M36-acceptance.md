# M36 — Playwright and Puppeteer attach

**Status: VERIFIED**

## Contract

For a running Chromium profile with automation enabled:

1. `GET /api/v1/profiles/:id/automation-attach` returns the CDP HTTP endpoint for `chromium.connectOverCDP` and `puppeteer.connect`, with `disconnectClosesBrowser: false`.
2. Closing the Playwright client does not stop the profile.
3. A Puppeteer client can attach to the same endpoint, disconnect, and a new Playwright client can attach again.
4. Firefox returns 409 `FIREFOX_NO_CDP`. Playwright and Puppeteer CDP attach are not claimed for Firefox.

## Evidence

- `test/automation-attach.test.js`
- `test/automation-attach-reconnect.test.js` (Playwright, then Puppeteer, then Playwright, on one headless profile)
- Existing `test/playwright-cdp-reconnect.test.js` and `test/puppeteer-cdp-attach.test.js`

## Boundary

Evidence is Linux headless Chromium. The descriptor does not retry a dead browser or retarget Firefox Marionette. Those are outside this row.
