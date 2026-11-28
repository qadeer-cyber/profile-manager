# Local product parity scorecard

Generated from `server/parity-scorecard.js`. Live values: `GET /api/parity-scorecard` (same formula).

**Formula:** `localProductParityPercent = sum(credits) / count × 100` where `VERIFIED=1`, `PARTIAL=0.5`, `UNSUPPORTED|BLOCKED|MISSING=0`.

This measures **this local desktop app**, not Multilogin cloud/SaaS. Masked/noise controls count as `UNSUPPORTED` on stock Chromium and Chrome Stable; the AZWAH Chromium row is `PARTIAL` because most of them are proven in Windows CI but WebGPU, real GPUs, real devices and a real Windows client are not.

| Area | Status | Evidence |
|------|--------|----------|
| Profile management | VERIFIED | test/m7-browser.test.js, SQLite profiles CRUD |
| Proxy library + SOCKS auth relay | VERIFIED | test/proxy-library.e2e.js, encrypted creds |
| Browser regional + advanced settings | VERIFIED | test/m3, test/m6 launch tests |
| Fingerprint privacy controls (stock) | PARTIAL | FINGERPRINT_PARITY_MATRIX.md — stock-Chromium rows; masked rows are in the AZWAH Chromium table of that file |
| Fingerprint diagnostics + consistency | VERIFIED | test/fingerprint-browser.test.js, test/fingerprint-gaps-browser.test.js |
| Cookies + local storage | VERIFIED | test/m7-browser.test.js isolation |
| Extensions per profile | VERIFIED | test/m4 extensions launch |
| Backup/restore + encryption | VERIFIED | test/backup*.test.js |
| Bulk ops + jobs | VERIFIED | test/bulk-jobs.test.js |
| Automation API /api/v1 | VERIFIED | test/api.e2e.js |
| Launch metrics + queue + resources | VERIFIED | test/m12, test/m13 benchmark |
| Windows process monitoring + smoke runner | PARTIAL | GHA windows-2022 m17-windows-validation run 40879417553; Latitude HD620 BLOCKED |
| Premium desktop UI + Advanced Monitoring | VERIFIED | web build; MonitoringPage separate from Dashboard |
| WebRTC policy + ICE diagnostics | VERIFIED | test/webrtc-observe.test.js, fingerprint-gaps-browser |
| Geolocation Allow/Ask/Deny | VERIFIED | test/fingerprint-gaps-browser.test.js |
| Chromium install backup/rollback | VERIFIED | test/chromium-lifecycle.test.js |
| Crash/orphan recovery + locks | VERIFIED | test/m17-crash-recovery.test.js, m17-windows-native-ci; GHA windows-2022 PASS |
| Multilogin-style masked fingerprints (AZWAH Chromium) | PARTIAL | AZWAH Chromium, Windows CI (live run 46075410661, build 45997594665): canvas, audio, screen, CPU/memory, WebGL name and readback, fonts, ClientRects, client hints, media device counts, WebRTC address, persistent per-profile fingerprint and dedicated/shared/service worker coverage all observed in the browser. NOT verified: WebGPU, real-GPU WebGL, real devices and a real proxy exit, cross-origin iframes, real Windows 10/11 client |

**Observation-only diagnostics do not earn VERIFIED** when Multilogin documents a user-facing control (e.g. canvas noise).

**Current local product parity:** **91.7%** (16.5/18 credits; formula unchanged; the AZWAH Chromium row stays PARTIAL until WebGPU, real hardware and a real client are verified).
