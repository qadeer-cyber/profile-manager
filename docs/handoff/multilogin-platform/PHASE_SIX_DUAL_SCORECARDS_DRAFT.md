# Phase Six prep — dual scorecards & engineering progress (draft)

**Branch:** `feature/dedicated-browser-engine`  
**Reference SHA for gates:** `b3349af` (owner green run; preserved)  
**Publish / preview / installer-smoke:** **NO-GO** until owner §19 sign-off — this document is local handoff only.

---

## Engineering progress (stock-honest)

| Phase | Focus | Status |
|-------|--------|--------|
| Zero–One | Core profiles, proxies, automation API, trash, templates | Largely **VERIFIED** in matrix |
| Two | Stock fingerprint feasibility research | `PHASE_TWO_STOCK_FINGERPRINT_FEASIBILITY.md` |
| Three–Five | Premium local polish (UI, diagnostics stock report, proxy switch UX) | In progress on branch tip |
| Six | Dual scorecards + release narrative (this doc) | **Draft** — not customer-facing |

**Coverage formula:** `(VERIFIED + 0.5 × PARTIAL) / 43` — see live counts in `MULTILOGIN_COMPLETE_TECHNOLOGY_MATRIX.md`.

**CI cadence note:** Rapid pushes to `feature/dedicated-browser-engine` cancel in-flight `engine-windows` jobs (~3s empty steps). Treat as concurrency cancel, not regression, when **local** `test:browser-runtime` is green. Codex owns workflow timeout/fixture diagnosis — do not edit `dedicated-browser-engine-win.yml` in feature batches.

---

## Scorecard A — Stock-local platform (what we ship)

| Metric | Typical tip snapshot | Notes |
|--------|---------------------:|-------|
| Matrix **VERIFIED** | 31 | Includes M2/M3 as **stock** engines, not Mimic/Stealthfox |
| Matrix **PARTIAL** | 7 | M20–M23, M28–M30 fingerprint class |
| **UNSUPPORTED** | 6 | M24–M27, M42 + custom-engine surfaces |
| **NOT_APPLICABLE_CLOUD** | 2 | M16, M39 |
| `test:browser-runtime` | 157+ | Local gate; Windows CI when not cancelled |

Honest ceiling: without a custom Chromium/Firefox antidetect build, M20–M30 stay **PARTIAL/UNSUPPORTED** per Phase Two.

---

## Scorecard B — Multilogin product parity (reference only)

| Multilogin-class area | Our honest status |
|----------------------|-------------------|
| Mimic / Stealthfox antidetect | **Not delivered** — stock CfT + stock Firefox (`engine-stock-report`) |
| Canvas / audio / WebGL / WebGPU noise | **Not delivered** — Phase Two blockers |
| Cloud teams / billing / profile sync | **N/A** — local `PM_DATA_DIR` |
| Built-in proxy pools / traffic saver | **N/A / not invented** — user proxies + provider APIs |
| Android cloud farms | **Not equivalent** — optional local ADB only (M40 scoped) |
| CAPTCHA-free Google (M42) | **Unsupported** — P1 findings |
| **Overall % parity** | **Not claimed** — use matrix row-by-row |

---

## Next stock-feasible work (no custom fork)

1. Keep fingerprint UI/API rejections tested (`fingerprint-catalog-api.test.js`, `fingerprint-stock-reject.test.js`).
2. Expand observable CDP tests for M20–M23 without promoting to VERIFIED.
3. Owner/Codex: Windows CI stability, backup atomicity proofs, XPI signing claims.

**Do not** publish installer or preview from this draft.
