# Google Search CAPTCHA — comparative methodology (Track B)

Authorized investigation only. **No solvers, no automation concealment, no guarantee of CAPTCHA-free sessions.**

## Matrix (manual or controlled runner; not automated against Google in CI)

| Scenario | Browser | Proxy | Purpose |
|----------|---------|-------|---------|
| A | Stock Chrome (user install) | None | Baseline client + home IP |
| B | Stock Chrome | Same SOCKS5/HTTP as PM profile | Isolate IP reputation |
| C | Profile Manager + bundled Chromium | None | PM client shape, residential IP |
| D | Profile Manager + bundled Chromium | Same proxy as B | Separate IP vs shape |

## Record per run (redacted logs only)

- Exit IP (if proxy) from app proxy test or `curl` via same endpoint
- Whether Bing loads (sanity)
- Whether Google Search shows CAPTCHA, interstitial, or normal results
- `navigator.webdriver`, UA string, automation flags (diagnostics page / first document)
- Launch argument diff vs manual Chrome (Playwright pipe, `--no-sandbox`, etc.)

## Interpretation (from alpha.2 evidence)

- Bing OK + Google CAPTCHA with working proxy → weight **IP reputation** and **Google stricter policy**, not broken PM navigation.
- PM adds Playwright control channel (`navigator.webdriver`, extra switches) → document as **client-shape delta**, not fixed by hiding webdriver in Alpha.3.

## Alpha.3 RC

No change to this methodology in the installer; fixes limited to **genuine config bugs** (e.g. broken proxy auth, wrong timezone persistence) backed by tests.
