# Ultimate 2.0 — engineering progress report (local handoff)

**Branch:** `feature/dedicated-browser-engine`  
**Closeout documentation tip:** `970dbc8`  
**Preserved owner gate SHA:** `b3349af` (do not reset; basis for §19 / Windows trust)  
**Preview / publish / installer-smoke:** **NO-GO** until owner sign-off.

---

## Executive summary

Profile Manager on this branch delivers a **stock-honest**, local-first Multilogin-**inspired** capability set: isolated profiles, proxy library, provider adapters (mocked in CI), automation API, workspaces, CookieRobot (Chromium), dual browser runtimes (CfT + Firefox), and extensive tests — **without** Mimic/Stealthfox, cloud sync, traffic saver fiction, or fingerprint noise on stock engines.

**Matrix coverage at tip:** `(31 VERIFIED + 0.5 × 7 PARTIAL) / 43 ≈ 80.2%`  
**Local tests at tip:** `npm run test:browser-runtime` → **157/157** pass.

Multilogin **product parity is not claimed.** See `PHASE_SIX_DUAL_SCORECARDS.md` (Scorecard A vs B).

---

## Phase timeline (Zero → Six)

| Phase | Focus | Outcome |
|-------|--------|---------|
| **Zero** | CookieRobot fixtures, purge recovery paths, CI stability groundwork | Green local suite expansion; baseline reliability |
| **One** | Matrix promotions: CLI (M35), workspaces (M38), ADB (M40), human input (M33), proxy library (M17/M18) | Multiple VERIFIED rows with targeted tests |
| **Two** | Stock fingerprint feasibility vs Multilogin masking | `PHASE_TWO_STOCK_FINGERPRINT_FEASIBILITY.md` — blockers for M20–M30 |
| **Three–Five** | Premium local polish: proxy switch UX, batch tests, backup API, automation UI/CLI, engine stock report, nav capability pills | UX + API depth without custom fork |
| **Six** | Dual scorecards + this progress report | Documentation closeout only — no release |

---

## Key commit tips (chronological reference)

| SHA | Batch theme (short) |
|-----|---------------------|
| `c97ad40` | Phase Zero — CookieRobot fixtures, purge recovery, CI test count baseline |
| `995c73a` | M35 CLI complete, M38 workspaces VERIFIED |
| `b68e2da` | M40 ADB VERIFIED scope + mock CI |
| `2bd93db` | M33 human input VERIFIED + UI |
| `35b9ab6` | M17/M18 proxy library VERIFIED (matrix) |
| `2c92ad4` | M8 backup API, M36/M37 automation surfaces VERIFIED |
| `1e6ee3a` | M2/M3 stock diagnostics, M12 window state, M14 Gecko UI VERIFIED |
| `970dbc8` | Phase Six polish — pills, matrix fingerprint notes, scorecard draft → closeout docs |

**Current doc tip:** `970dbc8`  
**Preserved gate:** `b3349af`

---

## Technology matrix snapshot (tip `970dbc8`)

| Status | Count | IDs (summary) |
|--------|------:|---------------|
| VERIFIED | 31 | Core platform, stock M2/M3, proxies M15–M18, automation M32–M37, M8, M12–M14, etc. |
| PARTIAL | 7 | **M20, M21, M22, M23, M28, M29, M30** only |
| UNSUPPORTED | 5 | **M24, M25, M26, M27, M42** |
| NOT_APPLICABLE_CLOUD | 2 | M16, M39 |

Full table: `MULTILOGIN_COMPLETE_TECHNOLOGY_MATRIX.md`.

---

## Testing & CI

| Gate | Status at closeout |
|------|-------------------|
| `test:browser-runtime` (local) | **157/157** pass |
| `engine-windows` (GitHub) | Often **cancelled** on rapid push; use completed runs + local green for feature work |
| `installer-smoke` | **Not re-triggered** by agent batches |
| Paid infra / custom Chromium fork | **Not used** |

**CI cadence note:** Prefer **one consolidated push** per batch so Windows jobs can complete. Codex diagnoses workflow/fixtures when runs fail after completion (not empty-step cancels).

---

## Fingerprint / custom engine policy

- **No new antidetect or spoof code** in Phase Six closeout.  
- M20–M30 remain PARTIAL/UNSUPPORTED per Phase Two.  
- API/UI **reject** invalid fingerprint modes (`fingerprint-stock-reject.test.js`, `fingerprint-catalog-api.test.js`).

---

## Codex vs Lead split

**Codex owns:** XPI signing claims, backup/restore atomicity, purge/recovery security, migration tests, Firefox isolation, CI fixture/timeout diagnosis, security regressions, `codex/ultimate2-local-completion`.

**Lead batches (through `970dbc8`):** Stock features, honest matrix, local tests, UI polish, handoff documentation — no overlap with Codex security/atomicity cores.

---

## Release gates (unchanged)

| Gate | Status |
|------|--------|
| Preview publish | **NO-GO** |
| Main merge / PR (unless owner directs) | **NO-GO** in agent batches |
| Preserve `b3349af` reference | **YES** |
| Installer-smoke re-run | **Owner/Codex only** |

---

## Related documents

- `PHASE_SIX_DUAL_SCORECARDS.md` — Scorecard A (stock-honest) vs B (Multilogin ambition)  
- `PHASE_TWO_STOCK_FINGERPRINT_FEASIBILITY.md` — M20–M30 blockers  
- `MULTILOGIN_COMPLETE_TECHNOLOGY_MATRIX.md` — row-level audit  
- `RELEASE_GATES_SECTION19.md` — owner gate checklist  

**End of Phase Six documentation closeout.** Further feature work awaits Lead instruction.

---

## Ultimate 2.0 feasible-local batch (`feature/ultimate2-feasible-completion`)

Stock-feasible acceptance for **M20–M30** (separate from matrix PARTIAL rows): see `FEASIBLE_LOCAL_ACCEPTANCE_M20_M30.md`. Matrix coverage remains **≈ 80.2%**; feasible-local criteria target **100% PASS** on stock controls only.
