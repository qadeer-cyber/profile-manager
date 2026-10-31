# Ultimate 3.0 Track A milestone — fingerprint M20–M23, M28–M30

**Branch:** `feature/ultimate3-fingerprint-m20-m30`  
**Base:** `09d25c46215113bdf33ad7718eea041c3e0adde3` (`integration/ultimate2-unified-pr` tip at start)  
**Code SHA:** `69ed7e96240129d5bef44be4d7cfa5a0a148586d`  
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

## Sprint 2 — causal M30 probe

**Branch tip before this sprint:** `1d6b63bbab9ffb1f4c71427b9db3ea9dea967c22`  
**Release-qualification before and after this sprint:** **67.4%** (20 VERIFIED / 18 PARTIAL). No new promotion.  
**Feature-completion after the causal probe:** **41 pass / 1 fail / 42 = 97.6%**.  
**M30 decision:** stays **PARTIAL**.

The probe holds address space fixed and varies only the profile deny preference. CORS is enabled so a completed fetch returns the body `local-ok`.

| Initiator | Preference | Permission | Fetch |
|-----------|------------|------------|-------|
| Loopback | absent | `prompt` | **200 `local-ok`** |
| Loopback | deny | `denied` | **200 `local-ok`** |
| Public-classified | absent | `prompt` | fails, target sees no request |
| Public-classified | deny | `denied` | fails, target sees no request |
| Public-classified | allow | `granted` | fails, target sees no request |

Stock CfT 156.0.8078.4 cannot show the preference as the cause. Where the request succeeds without deny, it still succeeds with deny. Where a public initiator is blocked, it stays blocked even if the preference is allow.

M21, M23, M28, and M29 stay **PARTIAL**. Added checks, not promotions:

- Native manual argv has no geolocation coordinate flag and no debugging port. Automation still applies Playwright coordinates and the retained client-hint session.
- Restricted font and media preferences do not contain a substitute font list or invented device names. `queryLocalFonts` stays absent and canvas measurement stays real.

M35 and M36 are still **PARTIAL** on this branch. Track B’s promotions of those IDs are not counted here.

M24–M27 were not touched. M42 was not touched.

## Next highest-impact action

M30 needs a browser whose local-network content setting actually gates the socket. This pinned CfT does not. Do not disable private-network checks to manufacture a pass, and do not open a debugging port on native manual launch to fake M21 coordinates.
