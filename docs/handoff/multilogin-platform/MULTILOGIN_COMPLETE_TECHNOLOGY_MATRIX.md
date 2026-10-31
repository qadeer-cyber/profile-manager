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
| M17 | Proxy templates / traffic saver | PARTIAL | Template tag + duplicate API; library summary (templates/health counts) in Proxies UI; **no traffic saver** (not measured) |
| M18 | Provider Bright Data/Oxylabs/Webshare | PARTIAL | Provider panel + mocks **CI-only** (`test/proxy-providers.test.js`); no live subscription required |
| M19 | Fingerprint: WebRTC | VERIFIED | Policy flags + prefs |
| M20 | Fingerprint: timezone/locale/lang | VERIFIED | Linux CfT 156.0.8078.4 CDP: timezone id, `getTimezoneOffset`, `navigator.language`, ordered languages, Intl locale, and Accept-Language (stock base-language fallback allowed). Second profile isolated. Firefox 159 Marionette: `TZ` observes Europe/Berlin and offset -60; `navigator.language` matches. Firefox Intl locale can stay the host locale. `privacy.timezone.override` is not the control. Not undetectable. Windows TZ not run. Evidence: `test/ultimate3-fingerprint-browser.test.js`, `docs/handoff/ultimate3/evidence/track-a-linux.json` |
| M21 | Fingerprint: geolocation | PARTIAL | Automation path: allow coordinates, deny, restart persistence, and cross-profile isolation pass (`test/ultimate3-fingerprint-browser.test.js`). Native manual spawn still has no coordinate override (BLOCKED_SPAWN). Phase 4 custom engine required for manual browse without a debugging port. Not promoted |
| M22 | Fingerprint: screen/DPR | VERIFIED | Product headless/automation launch: screen 1280×800, viewport 1280×800, devicePixelRatio 2 (`test/ultimate3-fingerprint-browser.test.js`). Headed native spawn sets window flags only. Multi-monitor identity is not claimed and needs a custom engine |
| M23 | Fingerprint: Navigator/UA/client hints | PARTIAL | Pinned full and reduced UA plus client hints (full version, platform, mobile false, Chromium brand) match CfT 156.0.8078.4 after the user-agent CDP session is retained. Arbitrary version spoof stays blocked. Not promoted |
| M24 | Fingerprint: Canvas noise | UNSUPPORTED | Stock Chromium |
| M25 | Fingerprint: AudioContext noise | UNSUPPORTED | Stock Chromium |
| M26 | Fingerprint: WebGL vendor/renderer mask | UNSUPPORTED | `--disable-webgl` only |
| M27 | Fingerprint: WebGPU mask | UNSUPPORTED | Observation only |
| M28 | Fingerprint: Fonts enumeration mask | PARTIAL | Restricted mode disables FontAccess, `queryLocalFonts` is absent, and canvas `measureText` stays real. Substitute font list remains BLOCKED_CUSTOM_ENGINE. Not promoted |
| M29 | Fingerprint: Media devices mask | PARTIAL | Restricted mode denies camera and microphone, `getUserMedia` is not granted, and `enumerateDevices` exposes no labels. Fake device names remain BLOCKED_CUSTOM_ENGINE. Not promoted |
| M30 | Port scan / local network protection | PARTIAL | Product process has no private-network weakening flags and `local-network-access` is denied. A public-classified loopback probe is blocked, and the same probe is also blocked without the deny preference, so the preference is not proven as the cause. Masked scan results remain BLOCKED_CUSTOM_ENGINE. Not promoted |
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

Checkpoint counts were **18 VERIFIED / 20 PARTIAL / 5 UNSUPPORTED / 0 MISSING / 2 NOT_APPLICABLE_CLOUD**, weighted **65.1%**. That checkpoint promoted nothing. M20 and M22 moved later; see Ultimate 3.0 Track A below. Existing other VERIFIED labels are inherited evidence classifications, not a claim that this Linux checkpoint requalified every category. See `CODEX_STABILIZATION_CHECKPOINT.md`.

## Integration note (`integration/ultimate2-stock-secure`)

Historical statuses at the Codex checkpoint were **18 VERIFIED / 20 PARTIAL / 5 UNSUPPORTED / 2 NOT_APPLICABLE_CLOUD**, weighted **65.1%**. Grok `8251394` promotions of M2, M3, M8, M12, M14, M17, M18, M33, M35, M36, M37, M38, and M40 to VERIFIED are **not adopted**. **M8 is not VERIFIED** — real Windows browser acceptance was not run. Feasible-local stock criteria are a separate scorecard in `FEASIBLE_LOCAL_ACCEPTANCE_M20_M30.md` (**23/23 PASS**; BLOCKED_CUSTOM_ENGINE excluded). The Grok **80.2%** scorecard stays separate and is not this denominator.

## Ultimate 3.0 Track A (`feature/ultimate3-fingerprint-m20-m30`)

Strict table after M20 and M22 promotion: **20 VERIFIED / 18 PARTIAL / 5 UNSUPPORTED / 2 NOT_APPLICABLE_CLOUD**. Release-qualification `(20 + 0.5 × 18) / 43 = 29/43 ≈ 67.4%` (was 65.1%, **+2.3 percentage points**). Feature-completion for the Track A stock checks is a different metric and is recorded in `docs/handoff/ultimate3/evidence/track-a-linux.json`. M21, M23, and M28–M30 stay **PARTIAL**. M24–M27 and M42 stay **UNSUPPORTED** / `BLOCKED_CUSTOM_ENGINE`. No CAPTCHA bypass. Windows qualification was not run.
