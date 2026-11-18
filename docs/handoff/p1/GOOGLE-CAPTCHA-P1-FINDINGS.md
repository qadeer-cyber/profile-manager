# P1 — Google sorry / reCAPTCHA loop (owner evidence + engineering response)

**Owner:** Mohammad Abbas  
**Product baseline:** Alpha.3 `v0.5.0-alpha.3-m1-m17` @ `2d65207`  
**Branch:** `feature/p1-captcha-rootcause` (does not retag Alpha.3)

## Owner symptoms (ruled in)

| Path | Observation |
|------|-------------|
| SOCKS5 → 162.33.165.29 | Endless `google.com/sorry` reCAPTCHA |
| Direct (no proxy), fresh profile | Same sorry loop; Google UI mentions IPv6 starting `2402…` |

**Ruled out as sole cause:** Original proxy only — direct path reproduces challenges.

## Confirmed findings

### (C) Application defect fixed — unnecessary `--disable-extensions` on extension-free profiles

Playwright injects `--disable-extensions` by default. The app previously ignored that switch **only when loading extensions**, leaving fresh profiles extension-locked unlike ordinary Chrome. That is a legitimate compatibility defect (not CAPTCHA bypass).

**Fix:** `extensionCommandArgs([])` now sets `ignoreDefaultArgs: ['--disable-extensions']` for all extension-free launches.

### (C) Application hardening — Chromium sandbox on packaged Windows

Packaged Windows builds now set `chromiumSandbox: true` so Playwright does not force `--no-sandbox` when the sandbox can run.

### (B) Unsupported / architectural (unchanged; not “bugs”)

- Bundled **Chromium for Testing**, not Google Chrome branding
- **Playwright control pipe** → `navigator.webdriver` commonly `true`
- Large Playwright default switch bundle vs manual Chromium (~4 args)
- **Multilogin-style mask/noise** remains unsupported on stock Chromium

### (A) Unavailable in CI / environmental

- Owner **Latitude 5480** physical path and **IPv6 routing** to Google (`2402…`) — not reproduced on GitHub `windows-2022`
- **Google IP/reputation scoring** — not observable inside the app; CAPTCHA after Bing works implicates stricter Google policy + client shape

## One-click local diagnostic

**Diagnostics → “Export Google compatibility (local JSON)”**

Returns JSON only to disk: launch-shape mitigations, Playwright-injected switch list, DNS A/AAAA for `google.com`, optional headless probe (`navigator.webdriver`, UA, gstatic reCAPTCHA script fetch). No proxy secrets; no remote upload.

API: `POST /api/google-compat/report` `{ "probe": true }`

## Comparison vs ordinary Chrome (methodology)

See `docs/handoff/track-b/CAPTCHA-COMPARATIVE-METHODOLOGY.md` and updated `CAPTCHA-ANALYSIS.md`. Steps 1–4 remain the owner-side A/B; the export replaces manual DevTools for PM-side signals.

## Patch release recommendation

**GO** for a follow-on **alpha.3.1** patch (extension-free launch + sandbox + diagnostics only). **NO-GO** for claiming Google Search will stop CAPTCHAs. Do **not** publish from this branch without a new tag decision.
