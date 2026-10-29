# Complete local feature backlog (Multilogin-comparable)

Priority: **P0** ship path · **P1** parity · **P2** nice · **P3** blocked/cloud

| P | Package | Backlog items | Target status |
|---|---------|---------------|---------------|
| P0 | Native manual runtime | Chromium native default; Firefox gecko spawn | VERIFIED |
| P0 | Profile config engine v2 | Typed model, warnings, migration | VERIFIED |
| P0 | Matrix + §22 living docs | Backed by tests | VERIFIED |
| P1 | Firefox runtime | Proxy/locale/cookies isolation; no Chrome flags | PARTIAL→VERIFIED |
| P1 | Native tab restore | Save tabs on native close | PARTIAL |
| P1 | Quick profiles + trash | Ephemeral + soft-delete + save regular | VERIFIED |
| P1 | Profile templates | Reusable preset rows + UI + bulk create | VERIFIED |
| P1 | CookieRobot-local | Job runner API + UI + URL guards | PARTIAL |
| P1 | Automation examples | Playwright/CDP samples in repo | PARTIAL |
| P1 | WebDriver localhost | ChromeDriver bridge API (automation CDP only) | PARTIAL |
| P2 | Bookmarks/history export | Stopped Chromium profile read API | VERIFIED |
| P2 | Running profile focus | Dashboard + profiles Focus button | PARTIAL (Win32/CDP) |
| P2 | Optional local ADB | List user devices when adb on PATH | PARTIAL |
| P2 | Performance benchmarks | Latitude-oriented metrics script | MISSING |
| P2 | Side-by-side browser rollback | CfT backup slot + rollback | VERIFIED |
| P2 | §19 installer CI smoke | Non-publishing windows-2022 job | VERIFIED (run 40934718409 @ `98dbc0c`) |
| P3 | Custom Chromium compile | Recipe only until approved infra | BLOCKED |
| P3 | Canvas/WebGL noise | Requires fork | UNSUPPORTED |
| N/A | Cloud sync/teams/billing | — | NOT_APPLICABLE_CLOUD |

## Completed increments (cumulative on branch)

- Audit matrix + §22 doc set  
- Native Chromium + Firefox gecko scaffold + config engine v2  
- P0 continuation: UI engine/trash/quick/templates API/tab harvest/pm-cli  
- Template UI increment (`4e9f730` / docs `11aab86`)  
- Rollback/WebDriver/provider increment (`dc60291` / docs `ecbdb10`)  
- Workspaces + CookieRobot + geckodriver (`e4214aa` / **60** runtime tests)  
- **This increment:** installer-smoke CI **green** (40934718409); export/ADB/focus; loopback bypass fix; Storage export buttons; **65** tests in `test:browser-runtime`

## Still open (honest)

- Bundled chromedriver / geckodriver (**MISSING**)  
- Custom Chromium compile (**BLOCKED**)  
- §19 preview publish (**NO-GO** until installer job green + owner)  
- Full Firefox CI without host Firefox (**BLOCKED** on GHA)  
- macOS/Linux native window focus (**MISSING**)

## Definition of done (VERIFIED)

Automated test or Windows CI log reference; no doc-only claims.
