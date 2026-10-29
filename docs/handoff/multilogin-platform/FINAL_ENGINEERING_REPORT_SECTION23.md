# §23 Final engineering report (checkpoint — P0 continuation)

**Model:** Composer 2.5 Fast  
**Branch:** `feature/dedicated-browser-engine`  
**Baseline:** Alpha.3 `2d65207` frozen; includes P1 `90f0d40` + prior engine work

## 1. Branch + commit SHA
**Branch:** `feature/dedicated-browser-engine` · **Commit:** `61a1bae32237ad06789d75eca7e5e9a8e47ec7a3` (P0 continuation on `38658ee` engine platform)

## 2. Multilogin technology audit
Matrix updated: M4/M5/M6/M11/M35/M36 reflect this increment.

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
**VERIFIED/PARTIAL** — quick profiles, trash, templates API; template UI **MISSING**.

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
Trash page + quick profile + engine/proxy settings; template UI **MISSING**.

## 16. Performance
**MISSING** Latitude benchmarks.

## 17. Security
Soft-delete preserves data until confirmed purge; settings path validation for Firefox exe.

## 18. Google compatibility
**PARTIAL** — no CAPTCHA promises.

## 19. Windows testing
`npm run test:browser-runtime` — target **39 pass / 0 fail** on windows-2022 workflow.  
**Preview installer §19: NO-GO.**

## 20. Next milestone
Template UI + save-quick-as-regular in profile row; WebDriver localhost bridge; Latitude dual-engine smoke.

**No Multilogin equivalence percentage claimed.**
