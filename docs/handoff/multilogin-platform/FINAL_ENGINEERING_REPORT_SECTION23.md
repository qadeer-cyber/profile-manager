# §23 Final engineering report — Phase G–H handoff

**Branch:** `feature/dedicated-browser-engine`  
**Final candidate SHA:** `09eeefd` (after green `engine-windows` run 40944392766)  
**Alpha.3 frozen:** `v0.5.0-alpha.3-m1-m17` @ `2d65207` — not retagged  
**Preview publish:** **NO-GO** until owner §19 sign-off  

---

## Dual scorecards (honest — no Multilogin %)

### Scorecard A — Stock-local platform (what we built)

| Metric | Count | Notes |
|--------|------:|-------|
| Matrix **VERIFIED** | 18 | M1, M4–M7, M9–M11, M13, M15, M19, M31–M32, M34, M41, M43–M45 |
| Matrix **PARTIAL** | 18 | Stock-engine limits; tests + UI where applicable |
| **UNSUPPORTED** | 6 | M14, M24–M27, M42 |
| **MISSING** | 1 | M33 typing emulation |
| **BLOCKED** | 1 | Custom Mimic compile |
| **NOT_APPLICABLE_CLOUD** | 2 | M16, M39 |
| `test:browser-runtime` | **108+** pass | See latest CI `engine-windows` |

### Scorecard B — Multilogin product parity (reference only)

| Category | Honest status |
|----------|----------------|
| Cloud sync / teams / billing | **Not applicable** — local-only product |
| Mimic / Stealthfox antidetect | **Not delivered** — stock CfT + stock Firefox |
| Android cloud farms | **Not delivered** — optional local ADB list only |
| CAPTCHA-free Google | **Unsupported** — no bypass |
| Traffic saver / ML proxy pools | **Not delivered** |
| **Overall parity** | **Not claimed** — use matrix row-by-row |

---

## 18-point final handoff

1. **Native Chromium manual path (M43)** — VERIFIED; native spawn default without automation pipe.  
2. **Firefox gecko runtime (M3 PARTIAL)** — Stock spawn; prefs/TZ; UI engine warnings; not Stealthfox.  
3. **Profile isolation & lifecycle (M1, M6–M7)** — VERIFIED; trash await-stop fixes @ Phase A.  
4. **Config engine v2** — VERIFIED; validate + browser-config warnings in UI.  
5. **Proxy library + templates (M15, M17 PARTIAL)** — Duplicate-as-template API + Proxies UI.  
6. **Provider adapters (M18 PARTIAL)** — Bright/Oxy/Webshare mocks in CI.  
7. **Fingerprint / locale / screen (M20–M23 PARTIAL)** — CDP observable tests; Firefox plan tests.  
8. **Privacy flags (M28–M30 PARTIAL)** — Launch-plan denies; no PNA weakening.  
9. **Tab restore (M11)** — CDP E2E with title evidence; native opt-in UX.  
10. **CookieRobot (M32)** — Chromium CDP lifecycle tests; Firefox blocked in UI/API.  
11. **Automation API + CLI (M34–M35 PARTIAL)** — `/api/v1`, `pm-cli`, examples.  
12. **Playwright / WebDriver (M36–M37 PARTIAL)** — CDP reconnect test; driver bridges + Settings opt-in cache.  
13. **Workspaces (M38 PARTIAL)** — CRUD UI, profile assignment, table filter.  
14. **ADB (M40 PARTIAL)** — Settings panel; parse tests; not a farm.  
15. **Backup / import (M8 PARTIAL)** — Checksum manifest; inspect UI shows checksum count.  
16. **Phase C blockers** — `CUSTOM_ENGINE_BLOCKER_INVENTORY.md`; no fake compile.  
17. **Phase E** — `SECURITY_RELIABILITY_CHECKLIST.md`, `LATITUDE_BENCHMARK_PACKAGE.md` (owner-run).  
18. **§19 gates** — Preview **NO-GO**; installer-smoke only on **final candidate SHA** (see `FINAL_CANDIDATE_SHA.md` after CI).

---

## CI / final candidate

| Job | Purpose |
|-----|---------|
| `engine-windows` | `npm run test:browser-runtime` + Firefox spawn on `windows-2022` |
| `installer-smoke-offline` | Only when commit message contains `[ci:installer-smoke]` |

Prior green installer-smoke: Actions **40934718409** @ `98dbc0c` (superseded by final candidate re-run when triggered).

---

## Owner actions

1. Review dual scorecards — no percentage fakery.  
2. Run Latitude benchmark on physical hardware if shipping to Latitude class.  
3. Sign §19 preview publish or keep NO-GO.  
4. Approve custom Chromium infra separately if ever desired (BLOCKED today).
