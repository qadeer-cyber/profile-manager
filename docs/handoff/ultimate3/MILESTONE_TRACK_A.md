# Ultimate 3.0 Track A milestone — fingerprint M20–M23, M28–M30

**Branch:** `feature/ultimate3-fingerprint-m20-m30`  
**Base:** `09d25c46215113bdf33ad7718eea041c3e0adde3` (`integration/ultimate2-unified-pr` tip at start)  
**Code SHA:** filled in after the implementation commit  
**Contract:** `docs/handoff/ultimate3/ACCEPTANCE_M20_M30_V1.md` (1.0.0)  
**Evidence:** `docs/handoff/ultimate3/evidence/track-a-linux.json`

## Metrics (do not mix)

| Metric | Before | After |
|--------|--------|-------|
| Release-qualification `(VERIFIED + 0.5 × PARTIAL) / 43` | 18 V / 20 P / 5 U / 2 cloud = **65.1%** | 20 V / 18 P / 5 U / 2 cloud = **67.4%** (+2.3 points) |
| Grok source scorecard | **80.2%** separate | **80.2%** separate, unchanged |
| Track A feature-completion | — | **37 pass / 1 fail / 38 stock checks = 97.4%** |

Feature-completion excludes blocked custom-engine remainders. It is not the strict matrix percent.

## Promoted

| ID | Result | What the live test showed |
|----|--------|---------------------------|
| M20 | **VERIFIED** | Chromium CDP: `Europe/Berlin`, offset `-60`, `de-DE`, languages `de-DE, en-US`, Intl locale `de-DE`, Accept-Language with the stock `de` fallback. Tokyo profile isolated (offset `-540`). Firefox 159 via the product `TZ` env and `user.js`: timezone `Europe/Berlin`, offset `-60`, `navigator.language` `de-DE`. Firefox Intl locale stayed `en-US`. Not undetectable. |
| M22 | **VERIFIED** | Product headless/automation launch: `screen` 1280×800, viewport 1280×800, `devicePixelRatio` 2. |

## Left PARTIAL

| ID | Why it was not promoted |
|----|-------------------------|
| M21 | Allow, deny, restart, and isolation pass on the automation path. Native manual spawn still cannot apply coordinates (`BLOCKED_SPAWN`). Phase 4 custom engine required for manual browse without a debugging port. |
| M23 | Pinned full and reduced user agents and client hints match CfT `156.0.8078.4` (session retained so hint metadata is not dropped). Inventing another Chrome version stays blocked. |
| M28 | FontAccess is disabled and `queryLocalFonts` is absent. Canvas `measureText` still sees real fonts. A substitute font list needs a custom engine. |
| M29 | Camera and microphone are denied, capture is not granted, and enumeration has no labels. Fake device names need a custom engine. |
| M30 | The product process does not weaken private-network checks, and `local-network-access` is denied. A public-classified loopback fetch is blocked, but the same fetch is also blocked when the deny preference is absent, so the preference is not proven as the cause. Masked port-scan results are not offered. |

M24–M27 and M42 stay **UNSUPPORTED**. No CAPTCHA bypass. No Mimic or Stealthfox code.

## Tests on this host

| Suite | Result |
|-------|--------|
| `npm run test:unit` | 142 pass / 0 fail |
| `npm run test:stabilization` | 90 pass / 0 fail |
| `npm run test:browser-runtime` | 188 pass / 0 fail |
| `test/ultimate3-fingerprint-browser.test.js` | 1 pass. Chromium 156.0.8078.4 and Firefox 159. |

## Security

- Private-network weakening flags are still refused.
- Client-hint metadata stays on the page’s CDP session instead of being detached. No new debugging port is opened for native manual browse.
- Native Chromium now sets `TZ` from the profile timezone. Firefox still uses `TZ` plus the documented non-controlling `privacy.timezone.override` line.
- No credentials, no CAPTCHA bypass, no Windows workflow dispatch.

## Windows

Still blocked. Support `#4931951` owns the Windows runners. This track did not run Windows browser qualification and did not edit Windows CI.

## Next highest-impact action

Prove or replace M30’s local-network deny so a public-origin probe succeeds without the preference and fails with it. Until that difference is observed, M30 stays PARTIAL. Native geolocation coordinates (M21) need a custom engine or an always-on location provider; do not open a standing debugging port to fake that.
