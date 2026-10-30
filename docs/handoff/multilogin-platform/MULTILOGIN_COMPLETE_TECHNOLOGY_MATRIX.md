# Multilogin complete technology matrix (clean-room audit)

**Product reference:** Multilogin help center (browser profiles, Mimic/Stealthfox, proxies, fingerprints, automation) — **no proprietary code/assets copied.**  
**Local product:** Profile Manager on `feature/dedicated-browser-engine`.  
**Statuses:** VERIFIED | PARTIAL | MISSING | UNSUPPORTED | BLOCKED | NOT_APPLICABLE_CLOUD

| ID | Multilogin capability (help/docs) | Local status | Evidence / notes |
|----|-----------------------------------|--------------|------------------|
| M1 | Isolated browser profiles (cookies/sessions) | VERIFIED | Per-profile `userDataDir`, locks, M1–M17 |
| M2 | Mimic (Chromium antidetect engine) | PARTIAL | Stock CfT + native spawn; **no custom Mimic compile** |
| M3 | Stealthfox (Firefox engine) | PARTIAL | Stock Gecko; proxy→direct + locale/TZ observables (`firefox-regional-observable.test.js`); **not** antidetect patches |
| M4 | Quick profiles | VERIFIED | `POST /api/profiles/quick` + UI button |
| M5 | Profile templates | VERIFIED | Templates page + row actions; bulk `fromTemplate` job; lifecycle tests |
| M6 | Trash bin restore | VERIFIED | Soft delete + Trash page + confirm purge; interrupted purge is reported without automatic deletion retry, and incomplete profiles require backup recovery |
| M7 | Clone profile | VERIFIED | `POST /profiles/:id/clone` + tests |
| M8 | Import/export profile | PARTIAL | Full/selective backups; portable row/tree rollback now tested after file movement and orphan-directory failures. Fresh-install proxy/extension/workspace portability and interrupted-process restore remain incomplete; no promotion |
| M9 | Folders/tags/bulk | VERIFIED | UI + bulk jobs API |
| M10 | Running profiles manager | VERIFIED | Dashboard + stop/start + Focus (Win32 or CDP) |
| M11 | Startup URLs / tabs | VERIFIED | Opt-in `restoreTabs` + `.pm-tabs.json`; `tab-restore-browser.test.js` (CDP reopen + Example Domain titles); native launch plan tests |
| M12 | Window state / maximized | PARTIAL | Opt-in `rememberLastWindow` + `.pm-window.json` on stop (`window-state.test.js`); Chromium flags + Firefox `-width`/`-height`; no OS-level multi-monitor persistence |
| M13 | Extension manager (Chromium) | VERIFIED | Unpacked MV2/MV3 library |
| M14 | Extension manager (Firefox) | PARTIAL | Bounded stored/deflated XPI ZIP validation, CRC and path checks; import does NOT verify signing. Firefox assignments are inventory only; install/manage in about:addons. Offline toggle returns 501 without writing extensions.json. Genuine signed installation/restart/isolation evidence pending |
| M15 | Proxy: HTTP/HTTPS/SOCKS5 custom | VERIFIED | Library + relay auth |
| M16 | Built-in Multilogin proxy pools | NOT_APPLICABLE_CLOUD | User-owned proxies + provider APIs |
| M17 | Proxy templates / traffic saver | PARTIAL | Template tag + duplicate API; library summary (templates/health counts) in Proxies UI; **no traffic saver** (not measured) |
| M18 | Provider Bright Data/Oxylabs/Webshare | PARTIAL | Provider panel + mocks **CI-only** (`test/proxy-providers.test.js`); no live subscription required |
| M19 | Fingerprint: WebRTC | VERIFIED | Policy flags + prefs |
| M20 | Fingerprint: timezone/locale/lang | PARTIAL | CDP observable tests; Firefox regional observables + documented limits in `profile-config-engine` (`FIREFOX_FINGERPRINT_LIMITS`) |
| M21 | Fingerprint: geolocation | PARTIAL | Prefs + `fingerprint-gaps-browser.test.js` |
| M22 | Fingerprint: screen/DPR | PARTIAL | Launch plan + CDP inner dimensions observable test |
| M23 | Fingerprint: Navigator/UA/client hints | PARTIAL | UA from pinned CfT; CDP `navigator.userAgent` test |
| M24 | Fingerprint: Canvas noise | UNSUPPORTED | Stock Chromium |
| M25 | Fingerprint: AudioContext noise | UNSUPPORTED | Stock Chromium |
| M26 | Fingerprint: WebGL vendor/renderer mask | UNSUPPORTED | `--disable-webgl` only |
| M27 | Fingerprint: WebGPU mask | UNSUPPORTED | Observation only |
| M28 | Fingerprint: Fonts enumeration mask | PARTIAL | `fingerprint-privacy-launch.test.js` local-fonts deny in launch plan |
| M29 | Fingerprint: Media devices mask | PARTIAL | Restricted mediaDevices → camera/mic deny in launch plan |
| M30 | Port scan / local network protection | PARTIAL | No PNA weakening flags; `privateNetworkWeakening()` in fingerprint-settings |
| M31 | Cookie import/export | VERIFIED | Chromium stopped SQLite; Firefox gecko **read/export** (`gecko-cookies.js`); import/clear Firefox **501** |
| M32 | CookieRobot / scripted warming | VERIFIED | Chromium CDP jobs + UI; `test/cookie-robot-cdp.test.js` (real connectOverCDP); Firefox **unsupported**; `GET /api/cookie-robot` |
| M33 | Human typing emulation | PARTIAL | Chromium CDP human input API + UI (`human-input.test.js`); authorized UI testing only |
| M34 | Local automation API | VERIFIED | `/api/v1` + bearer token |
| M35 | CLI / Script runner | PARTIAL | `pm-cli` workspaces/trash/clone/type/adb + JSON mode + examples |
| M36 | Playwright/Puppeteer attach | PARTIAL | Playwright reconnect + puppeteer-core attach (`puppeteer-cdp-attach.test.js`) |
| M37 | Selenium/WebDriver | PARTIAL | Stub session tests always; real create/navigate/quit when `PM_REAL_WEBDRIVER=1` (`webdriver-real.test.js`); opt-in driver cache |
| M38 | Workspaces / team sync | PARTIAL | Workspaces UI + local export bundle API; vault lock; no team cloud |
| M39 | Cloud profile storage | NOT_APPLICABLE_CLOUD | Local `PM_DATA_DIR` only |
| M40 | Android cloud phones / ADB farms | PARTIAL | Settings ADB list + `POST /api/adb/connect`; parse tests; **NOT farm-equivalent** |
| M41 | Core browser update / rollback | VERIFIED | Backup slot + rollback API + Diagnostics UI + update-manager report |
| M42 | Google Search CAPTCHA-free | UNSUPPORTED | P1 findings; no bypass |
| M43 | Manual browse without automation pipe | VERIFIED | Native Chromium spawn |
| M44 | DPAPI / secret encryption | VERIFIED | Existing crypto backend |
| M45 | Diagnostics / fingerprint check | VERIFIED | Hardware + consistency reports |

**Audit sources (public help, Oct 2026):** browser-profiles, profile-settings-proxy-section, profile-settings-fingerprint-section, multilogin-x-top-features, functionality hub.

## Codex stabilization checkpoint — 2026-10-30

Counts remain **18 VERIFIED / 20 PARTIAL / 5 UNSUPPORTED / 0 MISSING / 2 NOT_APPLICABLE_CLOUD**. Historical weighted score: **65.1% → 65.1% (+0.0 percentage points)**. No features promoted. Existing VERIFIED labels are inherited evidence classifications, not a claim that this Linux checkpoint requalified every category. See `CODEX_STABILIZATION_CHECKPOINT.md` for current test limitations.
