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
| M6 | Trash bin restore | VERIFIED | Soft delete + Trash page + confirm purge |
| M7 | Clone profile | VERIFIED | `POST /profiles/:id/clone` + tests |
| M8 | Import/export profile | PARTIAL | Full + per-profile `.pmp` portable export (`createProfileBackup`); backup UI inspect/restore; bookmarks/history export; not Multilogin format |
| M9 | Folders/tags/bulk | VERIFIED | UI + bulk jobs API |
| M10 | Running profiles manager | VERIFIED | Dashboard + stop/start + Focus (Win32 or CDP) |
| M11 | Startup URLs / tabs | VERIFIED | Opt-in `restoreTabs` + `.pm-tabs.json`; `tab-restore-browser.test.js` (CDP reopen + Example Domain titles); native launch plan tests |
| M12 | Window state / maximized | PARTIAL | Chromium launch flags + Firefox `-width`/`-height` from presets (`firefox-launch-window.test.js`); no OS-level multi-monitor persistence |
| M13 | Extension manager (Chromium) | VERIFIED | Unpacked MV2/MV3 library |
| M14 | Extension manager (Firefox) | PARTIAL | Gecko unpacked import with `gecko.id`, profile materialize on launch; Mozilla signing not bypassed (`gecko-extensions.test.js`) |
| M15 | Proxy: HTTP/HTTPS/SOCKS5 custom | VERIFIED | Library + relay auth |
| M16 | Built-in Multilogin proxy pools | NOT_APPLICABLE_CLOUD | User-owned proxies + provider APIs |
| M17 | Proxy templates / traffic saver | PARTIAL | Duplicate-as-template API + Proxies UI; no traffic saver |
| M18 | Provider Bright Data/Oxylabs/Webshare | PARTIAL | Mock fetch CI in `test/proxy-providers.test.js` (Bright/Oxy/Webshare); no live subscription required |
| M19 | Fingerprint: WebRTC | VERIFIED | Policy flags + prefs |
| M20 | Fingerprint: timezone/locale/lang | PARTIAL | CDP observable `fingerprint-observable-api.test.js`; Firefox `firefox-regional-observable.test.js` |
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
| M37 | Selenium/WebDriver | PARTIAL | ChromeDriver + GeckoDriver stub session + navigate tests; opt-in driver cache |
| M38 | Workspaces / team sync | PARTIAL | Workspaces UI + local export bundle API; vault lock; no team cloud |
| M39 | Cloud profile storage | NOT_APPLICABLE_CLOUD | Local `PM_DATA_DIR` only |
| M40 | Android cloud phones / ADB farms | PARTIAL | Settings ADB list + `POST /api/adb/connect`; parse tests; **NOT farm-equivalent** |
| M41 | Core browser update / rollback | VERIFIED | Backup slot + rollback API + Diagnostics UI + update-manager report |
| M42 | Google Search CAPTCHA-free | UNSUPPORTED | P1 findings; no bypass |
| M43 | Manual browse without automation pipe | VERIFIED | Native Chromium spawn |
| M44 | DPAPI / secret encryption | VERIFIED | Existing crypto backend |
| M45 | Diagnostics / fingerprint check | VERIFIED | Hardware + consistency reports |

**Audit sources (public help, Oct 2026):** browser-profiles, profile-settings-proxy-section, profile-settings-fingerprint-section, multilogin-x-top-features, functionality hub.
