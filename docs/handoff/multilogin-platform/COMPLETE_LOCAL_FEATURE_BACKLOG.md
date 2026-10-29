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
| P1 | CookieRobot-local | Documented API script + safety guards | PARTIAL |
| P1 | Automation examples | Playwright/CDP samples in repo | PARTIAL |
| P1 | WebDriver localhost | Optional chromedriver/geckodriver bridge | MISSING |
| P2 | Performance benchmarks | Latitude-oriented metrics script | MISSING |
| P2 | Side-by-side browser rollback | Two CfT slots | PARTIAL |
| P3 | Custom Chromium compile | Recipe only until approved infra | BLOCKED |
| P3 | Canvas/WebGL noise | Requires fork | UNSUPPORTED |
| N/A | Cloud sync/teams/billing | — | NOT_APPLICABLE_CLOUD |

## Completed increments (cumulative on branch)

- Audit matrix + §22 doc set  
- Native Chromium + Firefox gecko scaffold + config engine v2  
- P0 continuation: UI engine/trash/quick/templates API/tab harvest/pm-cli  
- **This increment:** Templates page (create/apply/bulk); profile row save-as-regular + save-as-template; native tab merge on stop/health; **44** tests in `test:browser-runtime`

## Still open (honest)

- WebDriver server (**MISSING**)  
- Custom Chromium compile (**BLOCKED**)  
- Latitude / preview EXE §19 (**BLOCKED** without owner)  
- Full Firefox CI without host Firefox (**BLOCKED** on GHA)

## Definition of done (VERIFIED)

Automated test or Windows CI log reference; no doc-only claims.
