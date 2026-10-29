# Fingerprint parity matrix

Compared with Multilogin’s fingerprint section (help article “Browser profile settings: Fingerprint section”, updated 31 July 2026): https://multilogin.com/help/profile-settings-fingerprint-section

This app is one local Windows profile manager. It does not mask signals, add noise, or promise that a profile is undetectable. Android cloud phones are out of scope.

**Browser evidence for this file:** Linux, headless Chromium 156.0.8078.4 (Playwright revision 1248), SwiftShader `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`. That renderer is not an Intel HD 620 result. See `docs/handoff/m10/WINDOWS-LATITUDE-5480.md`.

Classifications:

- **Fully implemented and browser-verified** — the behavior below was exercised in `test/fingerprint-browser.test.js` on this host.
- **Partially implemented** — some of the behavior exists; this run did not verify all of it.
- **Unsupported by stock Chromium** — this build has no honest control, and none was added.
- **Requires custom Chromium** — the Multilogin behavior needs a patched browser. It is rejected here.
- **Not yet implemented** — not built. Rows that would require an invented timezone or coordinate say so, and are not scheduled as fake values.

15 of these 30 rows are fully implemented and browser-verified. That fraction is the count of rows in this table. It is not a product-completeness score.

| # | Signal | What this app does | Classification |
|---|---|---|---|
| 1 | User-agent presets | Default leaves Chromium’s string. Reduced and full are built from the installed version only. This run: reduced headless UA was `HeadlessChrome/<major>.0.0.0` and did not contain `156.0.8078.4`. | Fully implemented and browser-verified |
| 2 | Client hints | A preset’s `uaFullVersion` and Chromium brand stay on the installed version. This run matched `156.0.8078.4`. | Fully implemented and browser-verified |
| 3 | `navigator.platform` | Reported as this computer. This run: `Linux x86_64`. A different OS token is not a setting. | Fully implemented and browser-verified |
| 4 | Timezone, explicit or host | Empty uses the computer. An IANA zone is passed through. This run: `UTC` matched the page. | Fully implemented and browser-verified |
| 5 | Locale and languages | BCP 47 tags, first language matching locale. This run: `en-US` matched `navigator.language` and `navigator.languages`. | Fully implemented and browser-verified |
| 6 | Screen, viewport, device scale | User-selected size and scale, or the host display. This run: 1280×800 at 2× matched `innerWidth`, `innerHeight`, `screen`, and `devicePixelRatio`. | Fully implemented and browser-verified |
| 7 | Geolocation Allow with saved coordinates | Chromium’s geolocation override. This run: 37.7, -122.4, accuracy 20. | Fully implemented and browser-verified |
| 8 | WebGL off | `--disable-webgl`. This run: no WebGL context, and the consistency check passed only with the flag present. No replacement renderer is written. | Fully implemented and browser-verified |
| 9 | WebGL vendor and renderer | Default shows the machine string. This run observed SwiftShader and marked metadata replacement unsupported. | Fully implemented and browser-verified |
| 10 | Local fonts permission | Restricted denies `local-fonts` on pages this app opens. This run: state `denied`. | Fully implemented and browser-verified |
| 11 | Camera and microphone | Restricted denies both. This run: both `denied`. Device names are not replaced. | Fully implemented and browser-verified |
| 12 | Canvas readback | Real pixels only. This run: the same SHA-256 after relaunch, including with WebGL off. | Fully implemented and browser-verified |
| 13 | AudioContext render | Real `OfflineAudioContext` render. This run: the same SHA-256 at 44100 Hz after relaunch. | Fully implemented and browser-verified |
| 14 | Profile storage | Separate user-data directories. This run: localStorage and a persistent cookie survived restart and did not appear in a second profile. | Fully implemented and browser-verified |
| 15 | Private-network command line | The live process did not disable `PrivateNetworkAccessSendPreflights`, `PrivateNetworkAccessRespectPreflightResults`, `BlockInsecurePrivateNetworkRequests`, or `LocalNetworkAccessChecks`. The check says this is not proof that every local port probe fails. | Fully implemented and browser-verified |
| 16 | WebRTC | Saved modes are Chromium’s IP-handling policies, including `disable_non_proxied_udp`. ICE candidate types are collected on a live page and summarized; they are not compared to the proxy IP. | Partially implemented |
| 17 | Geolocation prompt and deny | Ask and deny are stored and applied through the same permission path as other permissions. This browser run checked Allow, not prompt or deny. | Partially implemented |
| 18 | Canvas noise | Rejected. No noise field is stored. | Requires custom Chromium |
| 19 | AudioContext noise | Rejected. | Requires custom Chromium |
| 20 | WebGL or WebGPU metadata substitution | Rejected. WebGPU vendor and device ids are not settings. | Requires custom Chromium |
| 21 | Font-list mask | Rejected. Denying `local-fonts` does not stop canvas font measurement. | Requires custom Chromium |
| 22 | Media-device mask or custom counts | Rejected. | Requires custom Chromium |
| 23 | Masked port scans and a port whitelist | Rejected. | Requires custom Chromium |
| 24 | WebRTC address mask | Rejected. `disable_non_proxied_udp` is a path restriction, not an address. | Requires custom Chromium |
| 25 | `hardwareConcurrency`, `deviceMemory`, OSCPU | Not settings. OSCPU is a Firefox field. Observed counts stay the computer’s. | Unsupported by stock Chromium |
| 26 | Canvas API off | No supported switch in this build. `disabled` is rejected. | Unsupported by stock Chromium |
| 27 | WebRTC off | No supported switch. The mode is rejected. | Unsupported by stock Chromium |
| 28 | WebGPU off | `--disable-features=WebGPU` left `navigator.gpu` in place, and `requestAdapter()` returned no adapter with or without the flag. The mode is not offered. | Unsupported by stock Chromium |
| 29 | Timezone chosen from the proxy IP | Not built. An IP-derived zone would be an estimate, not a value Chromium reports on its own. | Not yet implemented |
| 30 | Coordinates chosen near the proxy | Not built. A generated point would be an invented coordinate. The user can type coordinates. | Not yet implemented |

Consistency statuses are only `pass`, `warning`, `unsupported`, and `unavailable`. Restart comparison accepts `canvasSha256`, `audioSha256`, and `webglRenderer`. Any other previous field, including a cookie, is a 400.
