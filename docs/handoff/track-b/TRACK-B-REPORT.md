# Track B report — advanced privacy / Google compat (docs + tests only)

**SHA (same tree as Alpha.3 RC):** `2d65207ca5f7d43436e35fe5f16fce8d7d0dd002`  
**Alpha.3 RC impact:** **No untested engine changes** — see `ALPHA3-ENGINE-IMPACT.md`.

## Implemented privacy capabilities (stock Chromium only)

- Per-profile regional, WebRTC policy, geolocation modes, extensions, proxy (SOCKS5/HTTP)
- Fingerprint **diagnostics** and consistency checks (not mask/noise)
- Isolated profile user-data dirs, encrypted proxy secrets, backup/restore
- Chromium install backup/rollback; crash/orphan recovery (M17)

## CAPTCHA root cause + evidence

- `docs/handoff/alpha2-validation/CAPTCHA-ANALYSIS.md` (alpha.2 installed EXE observation)
- Comparative methodology A–D: `CAPTCHA-COMPARATIVE-METHODOLOGY.md` (no automated Google probing in CI)

**Conclusion unchanged:** CAPTCHA on Google Search with working proxy/Bing is primarily **IP reputation + stricter site policy**, plus **real client-shape deltas** (Chromium vs Chrome, Playwright control channel). Not fixed by masking in Alpha.3.

## Compatibility improvements in Alpha.3 RC

- Application-layer only (M10–M17); **no** custom Chromium fork, **no** webdriver hiding.

## Windows automated results

- Same release run as Track A: https://github.com/qadeer-cyber/profile-manager/actions/runs/40912137853

## Custom Chromium feasibility

- `docs/handoff/m12/CUSTOM-CHROMIUM-FEASIBILITY.md` — **UNSUPPORTED** for this product line without dedicated CVE/build/test ownership.

## Honest parity

- **88.9%** local product scorecard; Multilogin mask row remains **UNSUPPORTED**.
