# §23 Final engineering report (checkpoint — installer smoke path + export/ADB/focus)

**Model:** Composer 2.5 Fast  
**Branch:** `feature/dedicated-browser-engine`  
**Baseline:** Alpha.3 `2d65207` frozen · prior tip `e4214aa` (workspaces/CookieRobot/geckodriver)

## 1. Branch + commit SHA
**Branch:** `feature/dedicated-browser-engine` · **Commit:** _(see git push; message includes `[ci:installer-smoke]`)_

## 2. Multilogin technology audit
M8 export **PARTIAL** (+ bookmarks/history read API); M10 running manager **VERIFIED** (+ Focus); M40 ADB **PARTIAL** (optional host `adb`, not farm-equivalent).

## 3–8. Architecture / privacy / custom EXE
Unchanged honest status; no custom Chromium EXE.

## 9. Profile management
Stopped-profile Chromium bookmarks/history export; running-session Focus/Locate API (Win32 or CDP).

## 10. CookieRobot-local
Unchanged from prior checkpoint.

## 13. Automation
Optional `GET /api/adb/devices` for user-owned Android USB debugging only.

## 14. Workspaces
Unchanged local-only.

## 16. Performance / Latitude
Unchanged; no invented metrics.

## 19. Windows testing
- `engine-windows` job: `npm run test:browser-runtime` — **65 pass / 0 fail** (added export/ADB/focus unit tests).  
- New `installer-smoke-offline` job: builds `dist:win:offline`, runs Alpha.3→branch preservation (`electron-smoke-branch-upgrade.js`) + `electron-smoke-offline.js`; **no GitHub release publish**. Trigger: `[ci:installer-smoke]` or workflow_dispatch.  
- **§19 preview publish: still NO-GO** until installer job green + owner sign-off; gates 2–4 now have automated evidence path.

## 20. Next milestone
Bundled drivers; Latitude physical smoke; custom Chromium **BLOCKED**.

**No Multilogin equivalence percentage claimed.**
