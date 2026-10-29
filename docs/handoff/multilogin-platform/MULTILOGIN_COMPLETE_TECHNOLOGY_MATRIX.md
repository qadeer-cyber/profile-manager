# Multilogin complete technology matrix (clean-room audit)

**Product reference:** Multilogin help center (browser profiles, Mimic/Stealthfox, proxies, fingerprints, automation) — **no proprietary code/assets copied.**  
**Local product:** Profile Manager on `feature/dedicated-browser-engine`.  
**Statuses:** VERIFIED | PARTIAL | MISSING | UNSUPPORTED | BLOCKED | NOT_APPLICABLE_CLOUD

| ID | Multilogin capability (help/docs) | Local status | Evidence / notes |
|----|-----------------------------------|--------------|------------------|
| M1 | Isolated browser profiles (cookies/sessions) | VERIFIED | Per-profile `userDataDir`, locks, M1–M17 |
| M2 | Mimic (Chromium antidetect engine) | PARTIAL | Stock CfT + native spawn; **no custom Mimic compile** |
| M3 | Stealthfox (Firefox engine) | PARTIAL | Gecko native spawn scaffold; not full Stealthfox patches |
| M4 | Quick profiles | MISSING | No ephemeral quick-profile type yet |
| M5 | Profile templates | MISSING | Clone/settings only; no named template library |
| M6 | Trash bin restore | MISSING | Hard delete today |
| M7 | Clone profile | VERIFIED | `POST /profiles/:id/clone` + tests |
| M8 | Import/export profile | PARTIAL | Backup/restore encrypted; not Multilogin format |
| M9 | Folders/tags/bulk | VERIFIED | UI + bulk jobs API |
| M10 | Running profiles manager | VERIFIED | Dashboard + stop/start |
| M11 | Startup URLs / tabs | PARTIAL | Startup URLs; native tab snapshot PARTIAL |
| M12 | Window state / maximized | PARTIAL | Chromium window flags; Firefox PARTIAL |
| M13 | Extension manager (Chromium) | VERIFIED | Unpacked MV2/MV3 library |
| M14 | Extension manager (Firefox) | UNSUPPORTED | Chromium-only extension loader |
| M15 | Proxy: HTTP/HTTPS/SOCKS5 custom | VERIFIED | Library + relay auth |
| M16 | Built-in Multilogin proxy pools | NOT_APPLICABLE_CLOUD | User-owned proxies + provider APIs |
| M17 | Proxy templates / traffic saver | PARTIAL | Saved proxies; no traffic saver |
| M18 | Provider Bright Data/Oxylabs/Webshare | PARTIAL | Webshare list API; others catalog stubs |
| M19 | Fingerprint: WebRTC | VERIFIED | Policy flags + prefs |
| M20 | Fingerprint: timezone/locale/lang | PARTIAL | Native: CLI; CDP locale Playwright-only |
| M21 | Fingerprint: geolocation | PARTIAL | Prefs + Playwright geolocation option |
| M22 | Fingerprint: screen/DPR | PARTIAL | Window/force-DPR flags (Chromium) |
| M23 | Fingerprint: Navigator/UA/client hints | PARTIAL | UA presets from CfT version; no HW spoof |
| M24 | Fingerprint: Canvas noise | UNSUPPORTED | Stock Chromium |
| M25 | Fingerprint: AudioContext noise | UNSUPPORTED | Stock Chromium |
| M26 | Fingerprint: WebGL vendor/renderer mask | UNSUPPORTED | `--disable-webgl` only |
| M27 | Fingerprint: WebGPU mask | UNSUPPORTED | Observation only |
| M28 | Fingerprint: Fonts enumeration mask | PARTIAL | local-fonts deny (CDP path) |
| M29 | Fingerprint: Media devices mask | PARTIAL | Permission deny |
| M30 | Port scan / local network protection | PARTIAL | Refuses weakening PNA flags |
| M31 | Cookie import/export | VERIFIED | cookies API |
| M32 | CookieRobot / scripted warming | PARTIAL | API + example script; no bundled bot |
| M33 | Human typing emulation | MISSING | Not implemented |
| M34 | Local automation API | VERIFIED | `/api/v1` + bearer token |
| M35 | CLI / Script runner | PARTIAL | npm scripts + examples; no shipped CLI binary |
| M36 | Playwright/Puppeteer attach | PARTIAL | CDP when `automation: true` |
| M37 | Selenium/WebDriver | MISSING | No local WebDriver server |
| M38 | Workspaces / team sync | NOT_APPLICABLE_CLOUD | Single-user local |
| M39 | Cloud profile storage | NOT_APPLICABLE_CLOUD | Local `PM_DATA_DIR` only |
| M40 | Android cloud phones / ADB farms | NOT_APPLICABLE_CLOUD | Optional future ADB user-device only |
| M41 | Core browser update / rollback | PARTIAL | Manifest-pinned CfT; rollback scaffold |
| M42 | Google Search CAPTCHA-free | UNSUPPORTED | P1 findings; no bypass |
| M43 | Manual browse without automation pipe | VERIFIED | Native Chromium spawn |
| M44 | DPAPI / secret encryption | VERIFIED | Existing crypto backend |
| M45 | Diagnostics / fingerprint check | VERIFIED | Hardware + consistency reports |

**Audit sources (public help, Oct 2026):** browser-profiles, profile-settings-proxy-section, profile-settings-fingerprint-section, multilogin-x-top-features, functionality hub.
