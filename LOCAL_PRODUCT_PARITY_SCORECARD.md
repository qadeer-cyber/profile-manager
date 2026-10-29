# Local product parity scorecard

Generated from `server/parity-scorecard.js`. Live values: `GET /api/parity-scorecard` (same formula).

**Formula:** `localProductParityPercent = sum(credits) / count × 100` where `VERIFIED=1`, `PARTIAL=0.5`, `UNSUPPORTED|BLOCKED|MISSING=0`.

This measures **this local desktop app** (M1–M16), not Multilogin cloud/SaaS. Masked/noise fingerprint controls count as `UNSUPPORTED` on stock Chromium.

| Area | Status | Evidence |
|------|--------|----------|
| Profile management | VERIFIED | M7 browser + SQLite |
| Proxy + encrypted creds | VERIFIED | proxy-library e2e |
| Browser config | VERIFIED | M3/M6 tests |
| Fingerprint controls (stock) | PARTIAL | Matrix rows requiring custom Chromium |
| Fingerprint diagnostics | VERIFIED | fingerprint-browser, gaps |
| Cookies/storage | VERIFIED | M7 isolation |
| Extensions | VERIFIED | M4 |
| Backup/restore | VERIFIED | backup tests |
| Bulk ops | VERIFIED | bulk-jobs |
| Automation API | VERIFIED | api e2e |
| Performance/monitoring | VERIFIED | M12/M13 |
| Windows stability smoke | PARTIAL | GHA windows-2022 PASS; Latitude HD620 not run |
| Desktop UI | VERIFIED | Dashboard + Advanced Monitoring |
| WebRTC + ICE | VERIFIED | webrtc-observe, gaps browser |
| Geolocation modes | VERIFIED | gaps browser |
| Chromium backup/rollback | VERIFIED | chromium-lifecycle |
| Crash/orphan recovery | VERIFIED | m17 tests + windows-2022 native CI |
| Multilogin mask parity | UNSUPPORTED | Custom engine — see privacy-engine report |

**Observation-only diagnostics do not earn VERIFIED** when Multilogin documents a user-facing control (e.g. canvas noise).

**Current local product parity:** **88.9%** (16/18 credits; formula unchanged).
