# Phase Six — dual scorecards (closeout)

**Integration:** On `integration/ultimate2-stock-secure` this file remains a record of `970dbc8`. It is **not** the historical score for the integration tip. Historical coverage stays **65.1%** (18 VERIFIED / 20 PARTIAL / 5 UNSUPPORTED / 2 cloud-excluded). The separate feasible-local scorecard is **23/23 PASS**, with BLOCKED_CUSTOM_ENGINE outside the denominator. **M8 is not VERIFIED.**

**Branch:** `feature/dedicated-browser-engine`  
**Documentation tip SHA:** `970dbc8` (stock-honest matrix + local tests at closeout)  
**Owner gate reference SHA:** `b3349af` (preserved — last owner-trusted green `engine-windows`; do not reset)  
**Preview / publish / installer-smoke:** **NO-GO** until owner §19 sign-off.

This document compares **Multilogin-class ambition** (help-center capabilities) with **what this repo honestly ships** on stock Chromium (CfT pin) and stock Firefox — without claiming Mimic, Stealthfox, or custom antidetect builds.

---

## Coverage (matrix scorecard math)

**Formula:** `Coverage = (VERIFIED + 0.5 × PARTIAL) / 43`

| Count | Value at tip `970dbc8` |
|-------|------------------------|
| **VERIFIED (V)** | **31** |
| **PARTIAL (P)** | **7** |
| **UNSUPPORTED** | **5** (M24–M27, M42) |
| **NOT_APPLICABLE_CLOUD** | **2** (M16, M39) |

**Coverage:** `(31 + 0.5 × 7) / 43 = 34.5 / 43 ≈ 80.2%`

Authoritative row-level status: `MULTILOGIN_COMPLETE_TECHNOLOGY_MATRIX.md`.

**Local test gate at closeout:** `npm run test:browser-runtime` → **157/157** pass.

---

## Scorecard A — Stock-honest platform (what we built & verified)

What Scorecard A measures: capabilities implemented on **stock engines**, with tests and UI where claimed **VERIFIED**.

| Theme | VERIFIED highlights (non-exhaustive) |
|-------|-------------------------------------|
| Profiles & lifecycle | M1, M4–M7, M9–M11, M43 |
| Engines (honest labels) | M2, M3 — **stock** CfT + Firefox; Diagnostics `GET /api/browser-engine/stock-report` |
| Proxies & providers | M15, M17, M18 — no traffic saver fiction |
| Extensions | M13, M14 — Chromium unpacked + Gecko library; no XPI signing bypass |
| Automation | M34–M37, M33, M32 (Chromium CDP CookieRobot) |
| Data & ops | M8, M31, M38, M40 (ADB scoped), M41, M44–M45 |

**Honest ceiling:** M20–M30 cannot reach VERIFIED without a **custom browser fork** or invented APIs. See Scorecard B and Phase Two.

---

## Scorecard B — Multilogin-comparable ambition (reference only)

What Scorecard B measures: how Multilogin markets the product — **not** a promise this repo fulfills.

| Multilogin-class claim | Local reality at `970dbc8` |
|------------------------|----------------------------|
| Mimic antidetect Chromium | **Not delivered** — M2 is stock CfT + native/automation paths only |
| Stealthfox antidetect Firefox | **Not delivered** — M3 is stock Gecko + managed prefs |
| Canvas / Audio / WebGL / WebGPU fingerprint masking | **Not delivered** — M24–M27 **UNSUPPORTED**; restrict/observe only |
| Timezone / locale / UA / screen “spoof” to arbitrary profiles | **Partial stock controls only** — M20–M23 **PARTIAL** |
| Font / media device enumeration masking | **Deny-only** — M28–M29 **PARTIAL** |
| Port-scan / local network masking | **Partial** — M30; no fake scan results |
| Cloud sync, teams, billing, ML proxy pools | **N/A** — M16, M39 |
| Traffic saver / bandwidth claims | **Not invented** — M17 analytics local-only |
| Android cloud phone farms | **Not equivalent** — M40 local ADB only |
| CAPTCHA-free Google Search | **Unsupported** — M42 |
| **Overall Multilogin % parity** | **Not claimed** — use matrix row-by-row |

**No overall parity percentage is published.** Scorecard B exists so stakeholders do not confuse Scorecard A coverage (~80%) with Multilogin product equivalence.

---

## Remaining fingerprint class (M20–M30) — PARTIAL + UNSUPPORTED

Blockers are detailed in `PHASE_TWO_STOCK_FINGERPRINT_FEASIBILITY.md`. Summary:

| ID | Status | Stock-feasible today | Blocker (Phase Two) |
|----|--------|----------------------|---------------------|
| M20 | PARTIAL | Locale/TZ/language prefs + observables | No Mimic-class consistent spoof across APIs |
| M21 | PARTIAL | Geolocation permission + coords override | Not a GPS/IP hide; other apps see real environment |
| M22 | PARTIAL | Window presets + CDP inner dimensions | No multi-monitor / screen API antidetect |
| M23 | PARTIAL | UA presets bound to **real** CfT version | Cannot lie client hints vs executable |
| M24 | UNSUPPORTED | Real canvas readback only | No noise API on pinned CfT |
| M25 | UNSUPPORTED | Real audio path only | No AudioContext noise API |
| M26 | UNSUPPORTED | `--disable-webgl` restrict only | No vendor/renderer string replacement |
| M27 | UNSUPPORTED | Observe `navigator.gpu` | No verified WebGPU identity mask switch |
| M28 | PARTIAL | Deny `local-fonts` permission | No substitute font list |
| M29 | PARTIAL | Deny camera/microphone | No fake device labels/counts |
| M30 | PARTIAL | No PNA weakening flags | No masked port-scan results |

**Policy:** Do not promote M20–M30 to VERIFIED without custom-engine evidence and tests that prove masking claims — not planned on this branch.

---

## CI cadence (feature branch)

- Rapid pushes to `feature/dedicated-browser-engine` often **cancel** in-flight `engine-windows` runs (~3s, empty steps) when a newer commit is pushed.
- When **local** `test:browser-runtime` is green (157/157 at closeout), treat those cancels as **concurrency**, not a demonstrated test regression, unless a completed run shows real failures.
- **Codex owns:** workflow timeouts, fixture diagnosis, installer-smoke, security regression suites — do not edit `dedicated-browser-engine-win.yml` in Lead feature batches.
- **Do not re-trigger installer-smoke** from agent batches.

---

## Codex coordination boundary (do not overlap)

Codex-owned workstreams (agent batches must not rewrite):

- XPI signing claims and signing bypass policy  
- Backup/restore **atomicity** and rollback security proofs  
- Purge/recovery security  
- Migration tests  
- Firefox test isolation fixtures  
- CI fixture/timeout diagnosis on Windows workflows  
- Security regression suites  
- Branch `codex/ultimate2-local-completion`

Lead agent batches: stock features, UI, local tests, matrix honesty, handoff docs.

---

## Phase Six outcome

- Dual scorecards **published locally** (this file).  
- Engineering progress narrative: `ULTIMATE_2_0_ENGINEERING_PROGRESS.md`.  
- **No publish, no preview, no installer-smoke** from this closeout.
