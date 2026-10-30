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
| M8 | Import/export profile | PARTIAL | Full backup + selective restore preview (`backup-selective.test.js`); Settings inspect/select-all restore UX; portable `.pmp` on Profiles; transactional restore/rollback; not Multilogin format |
| M9 | Folders/tags/bulk | VERIFIED | UI + bulk jobs API |
| M10 | Running profiles manager | VERIFIED | Dashboard + stop/start + Focus (Win32 or CDP) |
| M11 | Startup URLs / tabs | VERIFIED | Opt-in `restoreTabs` + `.pm-tabs.json`; `tab-restore-browser.test.js` (CDP reopen + Example Domain titles); native launch plan tests |
| M12 | Window state / maximized | PARTIAL | Opt-in `rememberLastWindow` + `.pm-window.json` on stop (`window-state.test.js`); launch presets + UI honesty (no monitor spoofing); Chromium flags + Firefox `-width`/`-height`; no OS-level multi-monitor persistence |
| M13 | Extension manager (Chromium) | VERIFIED | Unpacked MV2/MV3 library |
| M14 | Extension manager (Firefox) | PARTIAL | Unpacked + signed `.xpi` import (`gecko-xpi.test.js`); profile editor + Extensions page document Gecko path; `GET/PATCH …/gecko-extensions`; materialize on launch; no signing bypass |
| M15 | Proxy: HTTP/HTTPS/SOCKS5 custom | VERIFIED | Library + relay auth |
| M16 | Built-in Multilogin proxy pools | NOT_APPLICABLE_CLOUD | User-owned proxies + provider APIs |
| M17 | Proxy templates / traffic saver | VERIFIED | Template CRUD + instantiate (`proxy-library-m17.test.js`); tag groups + local analytics (`trafficSaverSupported: false`); batch test; safe direct/library switch; blocked assign for template/paused; health history UI; **no traffic saver / no invented bandwidth** |
| M18 | Provider Bright Data/Oxylabs/Webshare | VERIFIED | Provider panel + documented Bright/Oxy/Webshare adapters; import/materialize/usage; CI mocks (`proxy-providers.test.js`); secrets never in JSON; no paid subscription |
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
| M33 | Human typing emulation | VERIFIED | CDP + geckodriver paths; cancel/Unicode/special keys/WPM/deterministic; UI controls (`human-input*.test.js`); authorized UI testing only — no bypass |
| M34 | Local automation API | VERIFIED | `/api/v1` + bearer token |
| M35 | CLI / Script runner | VERIFIED | `pm-cli` profiles/workspaces/trash/proxy/extensions/cookies/diagnostics + `--json` + exit codes (`pm-cli-workflow.test.js`) |
| M36 | Playwright/Puppeteer attach | PARTIAL | Playwright reconnect + puppeteer-core attach (`puppeteer-cdp-attach.test.js`); Settings documents CDP `wsEndpoint` attach (automation launch required) |
| M37 | Selenium/WebDriver | PARTIAL | Stub session tests always; real create/navigate/quit when `PM_REAL_WEBDRIVER=1` (`webdriver-real.test.js`); Settings surfaces `/webdriver` + geckodriver/chromedriver start routes; opt-in driver cache |
| M38 | Workspaces / team sync | VERIFIED | CRUD, search, bulk assign, import/export metadata, vault lock; local only (`workspaces-api.test.js`); no team cloud |
| M39 | Cloud profile storage | NOT_APPLICABLE_CLOUD | Local `PM_DATA_DIR` only |
| M40 | Android cloud phones / ADB farms | VERIFIED | Local adb discovery/connect/disconnect/info/diagnostics + device selection UI; `PM_MOCK_ADB` CI tests (`adb-mock-ci.test.js`); **NOT farm-equivalent**; real USB unverified without hardware |
| M41 | Core browser update / rollback | VERIFIED | Backup slot + rollback API + Diagnostics UI + update-manager report |
| M42 | Google Search CAPTCHA-free | UNSUPPORTED | P1 findings; no bypass |
| M43 | Manual browse without automation pipe | VERIFIED | Native Chromium spawn |
| M44 | DPAPI / secret encryption | VERIFIED | Existing crypto backend |
| M45 | Diagnostics / fingerprint check | VERIFIED | Hardware + consistency reports |

**Audit sources (public help, Oct 2026):** browser-profiles, profile-settings-proxy-section, profile-settings-fingerprint-section, multilogin-x-top-features, functionality hub.
