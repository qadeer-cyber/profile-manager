# Feasible-local M20–M30 — closeout (stock-only)

**Branch:** `feature/ultimate2-feasible-completion`  
**Base:** `1df952a1ee1c3fe59b87ee74fb4a4a22fc2bd478`  
**Do not merge / no PR** unless owner directs.

## Scorecards (unchanged policy)

| Scorecard | Value |
|-----------|--------|
| Historical Multilogin matrix | **≈ 80.2%** — 31 VERIFIED, **7 PARTIAL (M20–M30)**, 5 UNSUPPORTED, 2 N/A |
| Feasible-local stock criteria (M20–M30) | **100%** — 22/22 PASS, 0 FAIL; 8 BLOCKED_CUSTOM_ENGINE excluded |

Matrix rows M20–M30 **remain PARTIAL** until custom-engine evidence exists. See `FEASIBLE_LOCAL_ACCEPTANCE_M20_M30.md`.

## BLOCKED_CUSTOM_ENGINE (no further local work without fork)

- M24 canvas noise · M25 AudioContext noise · M26 WebGL vendor/renderer replacement · M27 WebGPU identity mask  
- Mimic / Stealthfox parity · M42 CAPTCHA-free · Font list spoof · Fake media devices · Masked port-scan results  
- Multilogin cloud (M16, M39) · Traffic-saver fiction · Android cloud farms  

## Stock work completed on branch

- Feasible-local acceptance matrix + tests (`fingerprint-feasible-local-*`, `_browser-env.mjs`)  
- Negative / isolation / persistence tests (`fingerprint-feasible-local-negative.test.js`)  
- `observeBrowser` deadline (35s) + WebGPU adapter cap — avoids hung `GET …/hardware`  
- Browser tests use bundled/Playwright CfT resolution; skip when Chromium absent  

## Residual / environment notes

| Item | Status |
|------|--------|
| `GET /profiles/:id/hardware` full observation | May return `collection_failed` under load or auxiliary CDP; page-level and argv checks still qualify stock controls |
| Client hints via auxiliary CDP | Sometimes empty on Linux CfT; tests assert reduced UA on **process argv** when hints missing |
| `PM_AUTOMATION_DEFAULT=1` globally | Breaks native-runtime tests — **do not** set for full `test:browser-runtime` |
| Windows `engine-windows` | Not re-triggered from this branch |
| Codex-owned backup/recovery/XPI/CI | **Not modified** |

## Local gate (reference)

```bash
PLAYWRIGHT_BROWSERS_PATH=build/bundled-browsers npm run test:browser-runtime
```

Expect **164/164** pass when CfT is installed (includes feasible-local + negative tests).

**No further stock-feasible M20–M30 implementation planned without owner direction or custom engine.**
