# Complete local feature backlog (Multilogin-comparable)

Priority: **P0** ship path · **P1** parity · **P2** nice · **P3** blocked/cloud

| P | Package | Backlog items | Target status |
|---|---------|---------------|---------------|
| P0 | Native manual runtime | Chromium native default; Firefox gecko spawn | VERIFIED |
| P0 | Profile config engine v2 | Typed model, warnings, migration | VERIFIED |
| P0 | Matrix + §22 living docs | Backed by tests | VERIFIED |
| P1 | Firefox runtime | Proxy/locale/cookies isolation; no Chrome flags | PARTIAL→VERIFIED |
| P1 | Native tab restore | Save tabs on native close | PARTIAL |
| P1 | Quick profiles + trash | Ephemeral + soft-delete | MISSING |
| P1 | Profile templates | Reusable preset rows | MISSING |
| P1 | CookieRobot-local | Documented API script + safety guards | PARTIAL |
| P1 | Automation examples | Playwright/CDP samples in repo | PARTIAL |
| P1 | WebDriver localhost | Optional chromedriver/geckodriver bridge | MISSING |
| P2 | Template library UI | Premium UX 1366×768 | MISSING |
| P2 | Performance benchmarks | Latitude-oriented metrics script | MISSING |
| P2 | Side-by-side browser rollback | Two CfT slots | PARTIAL |
| P3 | Custom Chromium compile | Recipe only until approved infra | BLOCKED |
| P3 | Canvas/WebGL noise | Requires fork | UNSUPPORTED |
| N/A | Cloud sync/teams/billing | — | NOT_APPLICABLE_CLOUD |

## Completed increments (cumulative on branch)

- Audit matrix + §22 doc set  
- Native Chromium + Firefox gecko scaffold + config engine v2  
- **P0 continuation:** UI `browserEngine` + `firefoxExecutablePath`; native tab harvest + `--restore-last-session`; quick profiles; trash + Trash page; templates API; `pm-cli` + puppeteer doc; session/trash/cli tests (39 in `test:browser-runtime`)

## Still open (honest)

- Template UI + bulk-from-template UX  
- WebDriver server  
- Custom Chromium compile (**BLOCKED**)  
- Latitude / preview EXE §19 (**BLOCKED** without owner)  

## Definition of done (VERIFIED)

Automated test or Windows CI log reference; no doc-only claims.
