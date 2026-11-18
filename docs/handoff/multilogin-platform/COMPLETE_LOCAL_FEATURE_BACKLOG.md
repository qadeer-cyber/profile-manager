# Complete local feature backlog (Multilogin-comparable)

Priority: **P0** ship path · **P1** parity · **P2** nice · **P3** blocked/cloud

| P | Package | Backlog items | Target status |
|---|---------|---------------|---------------|
| P0 | Native manual runtime | Chromium native default; Firefox gecko spawn | VERIFIED |
| P0 | Profile config engine v2 | Typed model, warnings, migration | VERIFIED |
| P0 | Matrix + §22 living docs | Backed by tests | VERIFIED |
| P1 | Firefox runtime | Gecko prefs + read-only cookies; import/clear gecko N/A | PARTIAL |
| P1 | Native tab restore | Save tabs on native close + discoverable UX | VERIFIED |
| P1 | Quick profiles + trash | Ephemeral + soft-delete + save regular | VERIFIED |
| P1 | Profile templates | Reusable preset rows + UI + bulk create | VERIFIED |
| P1 | CookieRobot-local | CDP integration test + job runner | VERIFIED |
| P1 | Automation examples | WebDriver + geckodriver + gecko cookie export + profile-config | PARTIAL |
| P1 | WebDriver localhost | Bridge + opt-in driver cache (CfT/geckodriver) | PARTIAL |
| P2 | Bookmarks/history export | Stopped Chromium profile read API | VERIFIED |
| P2 | Running profile focus | Dashboard + profiles Focus button | PARTIAL (Win32/CDP) |
| P2 | Optional local ADB | List user devices when adb on PATH | PARTIAL |
| P2 | Performance benchmarks | `npm run benchmark:latitude-scaffold` (owner-run; no invented scores) | PARTIAL |
| P2 | Side-by-side browser rollback | CfT backup slot + rollback | VERIFIED |
| P2 | §19 installer CI smoke | Non-publishing windows-2022 job | VERIFIED (run 40950595111 @ `b3349af`; prior 40934718409 @ `98dbc0c`) |
| P3 | Custom Chromium compile | Recipe only until approved infra | BLOCKED |
| P3 | Canvas/WebGL noise | Requires fork | UNSUPPORTED |
| N/A | Cloud sync/teams/billing | — | NOT_APPLICABLE_CLOUD |

## Backlog saturation (honest)

Stock-implementable items are largely **done** or **read-only** (Firefox gecko cookies). Remaining work is **BLOCKED/UNSUPPORTED/cloud-N/A**, **platform gaps**, or **owner gates** (§19 preview). Full closure draft: **`SECTION23_FINAL_ENGINEERING_REPORT_DRAFT.md`**.

## Completed increments (cumulative on branch)

- Audit matrix + §22 doc set through CookieRobot/tab restore/Firefox prefs (**77** tests)
- Firefox gecko WebRTC/timezone + pm-cli bridges (**82** tests)
- **This increment:** gecko `moz_cookies` read/export + examples + §23 final draft (**85** tests)
- **A6 + B + C (latest):** GeckoDriver navigate stub, Firefox observables, tab-restore title evidence, Phase C blocker doc (**107** `test:browser-runtime`)
- **D–E + G–H (UI integration):** Workspaces/ADB/proxy template UI, security checklist, Latitude package, §23 handoff (**108** `test:browser-runtime`)
- **Phase F:** Final candidate installer-smoke green @ `b3349af` (run 40950595111); asar server path + CDP/lifecycle CI fixes; upgrade smoke starts branch server for migrations

## Still open (honest)

- Gecko cookie **import/clear** (**MISSING** — read/export only)  
- Drivers **in offline EXE** (**MISSING** by design)  
- Custom Chromium compile (**BLOCKED**)  
- §19 preview publish (**NO-GO** until owner sign-off)  
- macOS/Linux native window focus (**MISSING**)

## Definition of done (VERIFIED)

Automated test or Windows CI log reference; no doc-only claims.
