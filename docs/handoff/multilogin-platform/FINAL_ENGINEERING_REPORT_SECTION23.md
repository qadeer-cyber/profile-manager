# §23 Final engineering report (checkpoint — installer smoke GREEN)

**Model:** Composer 2.5 Fast  
**Branch:** `feature/dedicated-browser-engine`  
**Baseline:** Alpha.3 `2d65207` frozen  

## 1. Branch + commit SHA
**Tip:** `98dbc0c` (packaged native proxy loopback fix) · prior feature `cd72dfb` (export/ADB/focus + installer job)

## 2. Actions (windows-2022)
| Run | SHA | engine-windows | installer-smoke-offline |
|-----|-----|----------------|-------------------------|
| [40934718409](https://github.com/qadeer-cyber/profile-manager/actions/runs/40934718409) | `98dbc0c` | **success** | **success** (upgrade 8/8, offline smoke 45/0) |
| [40933139496](https://github.com/qadeer-cyber/profile-manager/actions/runs/40933139496) | `cd72dfb` | success | failure (loopback bypass on packaged native — fixed) |

Local: `npm run test:browser-runtime` — **65 pass / 0 fail**.

## 3. §19 preview gates
Gates **1–4**, **6**, **8** evidenced on run 40934718409. **NO-GO publish** until owner sign-off (gate 7) and bundled-driver / custom-engine blockers unchanged.

## 4. Product increments (since e4214aa)
- Installer-smoke CI (no `gh release create`)  
- Bookmarks/history export API + Storage UI download  
- Optional ADB device list (not farm-equivalent)  
- Running-profile Focus (Dashboard + Profiles)  
- Packaged native proxied launch adds `--proxy-bypass-list=<-loopback>`  

## 5. Still open (honest)
Bundled chromedriver/geckodriver **MISSING**; custom Chromium **BLOCKED**; M33 human typing **MISSING** (intentionally skipped); Latitude physical metrics **not invented**.

**No Multilogin equivalence percentage claimed.**
