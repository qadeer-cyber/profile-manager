# Feasible-local acceptance — M20–M30 (stock CfT / Firefox)

**Branch:** `feature/ultimate2-feasible-completion`  
**Base SHA:** `1df952a1ee1c3fe59b87ee74fb4a4a22fc2bd478`  
**Batch SHA:** `9675a96`  
**Policy:** This scorecard is **separate** from the historical Multilogin matrix (`MULTILOGIN_COMPLETE_TECHNOLOGY_MATRIX.md`). Matrix rows M20–M30 stay **PARTIAL** until a custom engine proves masking claims. Here we only grade **stock-feasible** acceptance criteria.

## Formulas

| Scorecard | Formula | At batch closeout |
|-----------|---------|-------------------|
| **Historical matrix coverage** | `(VERIFIED + 0.5 × PARTIAL) / 43` | **≈ 80.2%** (31 V + 7 P) — unchanged |
| **Feasible-local acceptance (M20–M30)** | `PASS criteria / (PASS + FAIL)` | **100%** when all rows below are PASS; BLOCKED rows are excluded from the denominator |

**BLOCKED_CUSTOM_ENGINE** = Multilogin-class claims documented in `PHASE_TWO_STOCK_FINGERPRINT_FEASIBILITY.md` (canvas/audio noise, WebGL/WebGPU identity mask, font list spoof, fake media devices, masked port-scan results, Mimic/Stealthfox parity).

---

## Acceptance matrix

| Matrix ID | Criterion | Result | Evidence | Real vs mocked |
|-----------|-----------|--------|----------|----------------|
| **M20** | `navigator.language` matches profile locale | **PASS** | `test/fingerprint-observable-api.test.js` | Real CfT CDP |
| **M20** | `Intl` timezone matches profile TZ | **PASS** | same | Real CfT CDP |
| **M20** | `navigator.languages` includes configured list | **PASS** | same | Real CfT CDP |
| **M20** | Firefox TZ/locale via launch plan + `user.js` | **PASS** | `test/firefox-regional-observable.test.js` | Real prefs (stub exe) |
| **M20** | Mimic-class consistent spoof across APIs | **BLOCKED** | Phase Two | Custom engine |
| **M21** | Geolocation **deny** observable (page permission) | **PASS** | `test/fingerprint-feasible-local-browser.test.js` | Real CfT CDP |
| **M21** | Geolocation **ask** → prompt | **PASS** | `test/fingerprint-gaps-browser.test.js` | Real CfT |
| **M21** | **Allow** + coordinates override | **PASS** | `test/fingerprint-browser.test.js`, `test/m6-browser.test.js` | Real CfT |
| **M21** | Invalid / incoherent geo rejected | **PASS** | `test/advanced-settings.test.js`, `test/fingerprint-feasible-local-acceptance.test.js` | Unit |
| **M21** | GPS / IP hide for other apps | **BLOCKED** | Phase Two | N/A |
| **M22** | Window preset → inner width/height | **PASS** | `test/fingerprint-observable-api.test.js` | Real CfT |
| **M22** | Device scale factor applied | **PASS** | `test/fingerprint-browser.test.js` | Real CfT |
| **M22** | Profile storage isolation (localStorage/cookies) | **PASS** | `test/fingerprint-browser.test.js` | Real CfT |
| **M22** | Multi-monitor / screen API antidetect | **BLOCKED** | Phase Two | Custom engine |
| **M23** | Full UA + client hints match pinned CfT | **PASS** | `test/fingerprint-observable-api.test.js` | Real CfT |
| **M23** | Reduced UA major-only; hints keep full version | **PASS** | `test/fingerprint-feasible-local-browser.test.js` | Real CfT |
| **M23** | Noise/mask/custom UA rejected | **PASS** | `test/fingerprint-stock-reject.test.js` | Unit + API |
| **M23** | Lie client hints vs executable | **BLOCKED** | Phase Two | Custom engine |
| **M28** | Restricted → `local-fonts` denied | **PASS** | `test/fingerprint-browser.test.js` | Real CfT |
| **M28** | Launch plan sets denied permission | **PASS** | `test/fingerprint-privacy-launch.test.js` | Unit plan |
| **M28** | Substitute font list | **BLOCKED** | Phase Two | Custom engine |
| **M29** | Restricted → camera + microphone denied | **PASS** | `test/fingerprint-browser.test.js` | Real CfT |
| **M29** | Restricted + Allow capture rejected | **PASS** | `test/fingerprint-privacy-launch.test.js` | Unit |
| **M29** | Fake device labels/counts | **BLOCKED** | Phase Two | Custom engine |
| **M30** | Launch plan omits PNA weakening `--disable-features` | **PASS** | `test/fingerprint-feasible-local-acceptance.test.js` | Unit |
| **M30** | `privateNetworkWeakening()` empty on normal argv | **PASS** | `test/fingerprint-settings.test.js` | Unit |
| **M30** | Live process argv has no PNA weakening; `port_scan_policy` pass | **PASS** | `test/fingerprint-feasible-local-browser.test.js` (`/resources` pid + `processCommandLine`), `test/fingerprint-feasible-local-acceptance.test.js` | Real CfT process + unit consistency |
| **M30** | Masked port-scan / whitelist fiction | **BLOCKED** | Phase Two | Custom engine |

**Feasible-local denominator:** 22 stock criteria → **22 PASS**, **0 FAIL**, **8 BLOCKED** (not counted).

---

## Codex boundary (unchanged)

No edits to encrypted portable v2/streaming, backup atomicity, recovery journal, purge crash recovery, Firefox XPI security, Windows CI fixtures, or integration security contracts on this branch.

---

## Related

- `PHASE_SIX_DUAL_SCORECARDS.md` — historical **≈ 80.2%** matrix coverage  
- `PHASE_TWO_STOCK_FINGERPRINT_FEASIBILITY.md` — BLOCKED surfaces  
- `test/_browser-env.mjs` — resolves bundled or Playwright-cache CfT for local browser tests
