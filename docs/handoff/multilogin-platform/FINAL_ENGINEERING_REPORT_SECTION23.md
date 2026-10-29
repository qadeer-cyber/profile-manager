# §23 Final engineering report (checkpoint — template UI + tab harvest)

**Model:** Composer 2.5 Fast  
**Branch:** `feature/dedicated-browser-engine`  
**Baseline:** Alpha.3 `2d65207` frozen; includes P1 `90f0d40` + engine platform + P0 `61a1bae`

## 1. Branch + commit SHA
**Branch:** `feature/dedicated-browser-engine` · **Commit:** `4e9f730d8fd9b91e5ae73ce31a0fc0105f6193b4` (template UI + tab harvest; prior checkpoint `61a1bae` / docs `6300add`)

## 2. Multilogin technology audit
Matrix/backlog updated: M5 templates **PARTIAL→UI VERIFIED** (API+Templates page+bulk job); M11 tab harvest hardened; M37 WebDriver still **MISSING**.

## 3. Browser architecture A–I
Unchanged layers; native Chromium + Firefox gecko paths; Playwright automation adapter.

## 4. Independent manual browser proof
**VERIFIED** (Chromium native + tests). Firefox host spawn **BLOCKED** on CI without installed Firefox.

## 5. Real privacy controls
Stock-supported controls unchanged; UI exposes **browserEngine** selection.

## 6. Custom Chromium
**BLOCKED** — no compiled EXE.

## 7. Firefox runtime
**PARTIAL** — Settings `firefoxExecutablePath` + profile editor engine selector.

## 8. Profile config engine
**VERIFIED** — schema/validate APIs + UI engine field.

## 9. Profile management
**VERIFIED/PARTIAL** — quick profiles + save-as-regular in profile row; trash; **templates UI** (create from profile, apply, bulk `fromTemplate` job).

## 10. Cookies / CookieRobot-local
**PARTIAL** — example script + CLI; no bundled robot UI.

## 11. Proxy / network
**VERIFIED** (unchanged).

## 12. Extensions
Chromium **VERIFIED**; Firefox **UNSUPPORTED**.

## 13. Local automation
**PARTIAL** — `npm run pm-cli`, puppeteer attach doc; WebDriver **MISSING**.

## 14. Workspaces / ADB
**NOT_APPLICABLE_CLOUD**.

## 15. Premium UX
Templates nav page; quick badge + save regular; trash page.

## 16. Performance
**MISSING** Latitude benchmarks.

## 17. Security
Soft-delete + confirmed purge; template delete is metadata-only (no profile cookies).

## 18. Google compatibility
**PARTIAL** — no CAPTCHA promises.

## 19. Windows testing
`npm run test:browser-runtime` — **44 pass / 0 fail** target on `dedicated-browser-engine-win.yml`.  
**Preview installer §19: NO-GO.**

## 20. Next milestone
WebDriver localhost bridge (automation profiles only); Latitude dual-engine smoke; custom Chromium compile remains **BLOCKED**.

**No Multilogin equivalence percentage claimed.**
