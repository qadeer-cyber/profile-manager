# Fingerprint parity matrix

Reference: [Multilogin — Browser profile settings: Fingerprint section](https://multilogin.com/help/profile-settings-fingerprint-section) (updated 31 July 2026).

Scope: **local stock Chromium** via Playwright pin. No cloud phones, no mask/noise unless Chromium genuinely supports it. Classifications apply to **controls**; diagnostics alone are noted in the “Evidence” column.

**Browser evidence (automated):** Linux headless Chromium 156.x in `test/fingerprint-browser.test.js`, `test/fingerprint-gaps-browser.test.js`, `test/m14-settings-persistence.test.js`. **Not** Intel HD 620 — Windows manual row in `docs/handoff/m10/WINDOWS-LATITUDE-5480.md`.

Legend — **Status:** FULL = implemented control + browser test; PART = partial; STOCK = unsupported on stock Chromium; CUSTOM = requires patched Chromium; NONE = not planned (honest gap).

| # | Multilogin signal | Current implementation | Required behavior (Multilogin) | Stock Chromium | Real approach here | Automated evidence | Windows evidence | Remaining limitation |
|---|-------------------|------------------------|--------------------------------|----------------|--------------------|--------------------|------------------|----------------------|
| 1 | WebRTC Masked/Custom/Real/Disabled | Modes map to `--force-webrtc-ip-handling-policy=*`; no off/mask IP | Proxy-aligned or custom IP; disabled option | Policies only; no true off/mask | Saved policy flags + ICE observation | `webrtc-observe.test.js`, gaps browser | BLOCKED native | No proxy-IP synthesis |
| 2 | Timezone Masked/Custom/Real | IANA `timezoneId` or host; no IP-derived mask | Auto match proxy | Pass-through IANA | Profile `browserSettings.timezoneId` | fingerprint-browser, consistency | BLOCKED | No geo-IP timezone |
| 3 | Geolocation Prompt | `ask` → permission prompt | Prompt default | CDP permission | `advancedSettings.geolocation.permission` | gaps browser | BLOCKED | — |
| 4 | Geolocation Allow/Block | allow/deny + coords on allow | Allow/block + coords | Override + permission | Same + Playwright geolocation | gaps + fingerprint-browser | BLOCKED | — |
| 5 | Geolocation data Masked/Custom | User-entered lat/long only | Proxy-near coords | Override only | Manual coordinates | fingerprint-browser allow | BLOCKED | No auto offset |
| 6 | Languages Masked/Custom/Real | BCP-47 list + `--accept-lang` | Masked defaults or custom order | Launch args + navigator | `browserSettings.languages` | fingerprint-browser | BLOCKED | No silent English default |
| 7 | Screen Masked/Custom/Real | preset native/custom + viewport/DPR | Auto or custom CSS px | Window/viewport flags | `advancedSettings.screen` | fingerprint-browser | BLOCKED | Host must fit custom size |
| 8 | Font data Masked/Real | `fonts: restricted` denies local-fonts | OS font mask | Permission only | CDP on navigation | fingerprint-browser | BLOCKED | Canvas font measure not blocked |
| 9 | Media devices Masked/Custom/Real | `mediaDevices: restricted` + permissions | Fake device counts | Deny capture | Permission + enumerate observe | fingerprint-browser | BLOCKED | No fake device list |
| 10 | Navigator UA/Platform/HW | reduced/full UA; host platform | Coordinated mask | Version-based UA only | `userAgent` + client hints check | fingerprint-browser | BLOCKED | No HW concurrency override |
| 11 | WebGL metadata Masked/Custom | Real UNMASKED strings observed | Spoof vendor/device | Not spoofable | Diagnostic only | consistency unsupported | BLOCKED | — |
| 12 | WebGL graphics Noise/Real | `webgl: restricted` disables WebGL | Persistent noise | `--disable-webgl` | Launch flag + context check | fingerprint-browser | BLOCKED | No noise |
| 13 | Canvas Noise/Real/Disabled | `canvas: real` only | Noise default | No API | Real readback + SHA stability | fingerprint-browser restart | BLOCKED | No disable/noise |
| 14 | AudioContext Noise/Real | `audio: real` only | Noise option | No API | OfflineAudioContext probe | fingerprint-browser | BLOCKED | No noise |
| 15 | Port scan Masked/Custom/Real | `portScan: real`; refuse weaken PNA | Masked ports | Browser checks | Command-line consistency | fingerprint-browser PNA | BLOCKED | No whitelist mask |
| 16 | WebGPU metadata | Observed adapter info | Mask vendor/device | Unreliable disable | Diagnostic in /hardware | hardware API | BLOCKED | No spoof |
| 17 | Client hints vs UA | Consistency engine | Match version | High entropy API | `fingerprint-consistency` | unit + browser | BLOCKED | — |
| 18 | Private network protections | No `--disable-features` weakening PNA/LNA | N/A | Keep defaults | `privateNetworkWeakening()` | fingerprint-browser | BLOCKED | Not full port audit |
| 19 | Profile isolation | Separate user-data-dir | Per profile | Chromium profile | Filesystem + locks | fingerprint-browser | BLOCKED | — |
| 20 | Settings persistence | SQLite JSON columns | Persist | N/A | DB storage | m14-settings-persistence | BLOCKED | — |
| 21 | ICE diagnostics | In-page gather + type summary | N/A | RTCPeerConnection | `webrtc-observe.js` | gaps browser | BLOCKED | Not leak proof |
| 22 | Consistency interpretation | Headline + findings | N/A | Compare config vs page | `fingerprint-summary.js` | m14 API | BLOCKED | — |
| 23 | Browser version gate | `executableCompatibility` | N/A | Pin match | chromium-lifecycle | m11 test | BLOCKED | — |
| 24 | Chromium rollback | Install backup dir | N/A | File replace | `installWithBackup` | chromium-lifecycle | BLOCKED | — |

**Full control + automated browser verification (this repo):** rows 3–4 (ask/deny subset), 6–7 (when configured), 8–9 (restricted), 12 (restricted), 13–15 (real + checks), 17–21, 19–20 — **18 rows** with automated tests touching the signal (some Multilogin “mask” behaviors intentionally **not** implemented).

**Stock Chromium gap (CUSTOM):** Multilogin default **Masked/Noise** on WebRTC IP, timezone, languages, screen, fonts, media, navigator HW, WebGL/WebGPU metadata, canvas, audio, port scan — see `GET /api/privacy-engine`.

**Score:** Use `LOCAL_PRODUCT_PARITY_SCORECARD.md` for whole-product %; fingerprint **control** parity vs Multilogin defaults is lower by design (honest stock browser).
