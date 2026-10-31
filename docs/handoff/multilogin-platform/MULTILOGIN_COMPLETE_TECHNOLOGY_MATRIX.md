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
| M6 | Trash bin restore | VERIFIED | Soft delete + Trash page + confirm purge; quarantine, durable journal and explicit remaining-file recovery; no destructive startup retry; incomplete files require backup recovery |
| M7 | Clone profile | VERIFIED | `POST /profiles/:id/clone` + tests |
| M8 | Import/export profile | PARTIAL | Encrypted portable v2 restores workspace/proxy/extension dependencies with collision mapping on fresh installations. Journaled full/portable restores pass process-interruption tests. Native browser readback, Windows and rendered UI acceptance pending; no promotion |
| M9 | Folders/tags/bulk | VERIFIED | UI + bulk jobs API |
| M10 | Running profiles manager | VERIFIED | Dashboard + stop/start + Focus (Win32 or CDP) |
| M11 | Startup URLs / tabs | VERIFIED | Opt-in `restoreTabs` + `.pm-tabs.json`; `tab-restore-browser.test.js` (CDP reopen + Example Domain titles); native launch plan tests |
| M12 | Window state / maximized | PARTIAL | Opt-in `rememberLastWindow` + `.pm-window.json` on stop (`window-state.test.js`); Chromium flags + Firefox `-width`/`-height`; no OS-level multi-monitor persistence |
| M13 | Extension manager (Chromium) | VERIFIED | Unpacked MV2/MV3 library |
| M14 | Extension manager (Firefox) | PARTIAL | Bounded stored/deflated XPI ZIP validation, CRC and path checks; import does NOT verify signing. Firefox assignments are inventory only; install/manage in about:addons. Offline toggle returns 501 without writing extensions.json. Genuine signed installation/restart/isolation evidence pending |
| M15 | Proxy: HTTP/HTTPS/SOCKS5 custom | VERIFIED | Library + relay auth |
| M16 | Built-in Multilogin proxy pools | NOT_APPLICABLE_CLOUD | User-owned proxies + provider APIs |
| M17 | Proxy templates / traffic saver | PARTIAL | Templates store a traffic policy and instantiate copies it. `POST /api/v1/proxies/traffic/measure` counts loopback HTTP origin response body bytes; `savingsBytes` is only the paired-session difference (`test/proxy-traffic.test.js`). `trafficSaverSupported` stays false: HTTPS CONNECT hides URL paths, and launch does not insert the meter |
| M18 | Provider Bright Data/Oxylabs/Webshare | PARTIAL | Recorded contracts for Bright Data balance/zone, Oxylabs client-stats, and Webshare list/profile/subscription (`test/proxy-provider-contracts.test.js`); secrets redacted. Live `PM_PROVIDER_LIVE=1` not executed |
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
| M33 | Human typing emulation | PARTIAL | Chromium CDP `interkey-wpm-v1` with measured inter-key intervals (`test/human-input.test.js`); authorized UI testing only. Firefox W3C pauses report `timingMeasured: false` |
| M34 | Local automation API | VERIFIED | `/api/v1` + bearer token |
| M35 | CLI / Script runner | VERIFIED | `pm-cli --json run` API scripts and `exec` node files (`shell: false`, optional `PM_CDP_HTTP`; `test/pm-cli-script.test.js`, `test/pm-cli-exec-cdp.test.js`) |
| M36 | Playwright/Puppeteer attach | VERIFIED | Attach descriptor; Playwright disconnect, Puppeteer attach, Playwright reconnect on one running Chromium profile (`test/automation-attach-reconnect.test.js`). Firefox CDP attach is 409 |
| M37 | Selenium/WebDriver | PARTIAL | Stub session uses `newSession.debuggerAddress`. Real create/navigate/title/element/window rect/quit when `PM_REAL_WEBDRIVER=1` (`test/webdriver-real.test.js`); not run on this host. `fullParity: false` |
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

## Integration note (`integration/ultimate2-stock-secure`)

Historical statuses at the Codex checkpoint, locked as the Ultimate 3 baseline on `09d25c46215113bdf33ad7718eea041c3e0adde3`: **18 VERIFIED / 20 PARTIAL / 5 UNSUPPORTED / 2 NOT_APPLICABLE_CLOUD**, weighted **65.1%**. Grok `8251394` promotions of M2, M3, M8, M12, M14, M17, M18, M33, M35, M36, M37, M38, and M40 to VERIFIED are **not adopted**. **M8 is not VERIFIED** — real Windows browser acceptance was not run. Feasible-local stock criteria are a separate scorecard in `FEASIBLE_LOCAL_ACCEPTANCE_M20_M30.md` (**23/23 PASS**; BLOCKED_CUSTOM_ENGINE excluded). That scorecard does not change this historical denominator.

## Ultimate 3 Track B (`feature/ultimate3-automation-proxies`)

Strict formula stays `(VERIFIED + 0.5 × PARTIAL) / 43`. The locked baseline is **65.1%** and is not rewritten.

Promoted on this branch, with the tests named in the rows: **M35** and **M36** only. M17, M18, M33, and M37 stay **PARTIAL**. M20–M30, M2/M3 custom engines, and M42 were not touched.

| | V | P | U | NA | Weighted |
|--|---|---|---|----|----------|
| Locked baseline | 18 | 20 | 5 | 2 | (18 + 10) / 43 ≈ **65.1%** |
| After Track B | 20 | 18 | 5 | 2 | (20 + 9) / 43 ≈ **67.4%** |

Delta: **+2.3 percentage points**. The six-id track checklist in `docs/handoff/ultimate3/README.md` is not a second coverage percent.
