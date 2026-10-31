# Release qualification GO/NO-GO (M17 → Alpha.3)

**Branch:** `feature/m10-local-parity`  
**Alpha.3 packaging:** authorized on Actions windows-2022 when `alpha3-release-validation` passes.

| Gate | Status | Evidence |
|------|--------|----------|
| M10–M17 regressions (Windows) | **PASS** | [m17 run 40879417553](https://github.com/qadeer-cyber/profile-manager/actions/runs/40879417553) |
| Win32 CIM + concurrent profiles | **PASS** | `test/m17-windows-native-ci.test.js` in that run |
| Alpha.3 installer build + clean install smoke | **PENDING** | `alpha3-release-validation` workflow |
| Alpha.2 → Alpha.3 data preservation | **PENDING** | `test/electron-smoke-alpha3-upgrade.js` in release job |
| Physical Latitude / HD 620 | **BLOCKED** | Hyper-V Video on GHA only |
| Multilogin mask on stock Chromium | **UNSUPPORTED** | Documented — not a blocker for honest preview |
| Packaged release publish | **PENDING** | Requires green release job + `[publish]` or `publish_release=true` |

**Local product parity (honest):** see `GET /api/parity-scorecard` — expect **~88.9%** after windows_stability PARTIAL + crash_recovery VERIFIED (weights unchanged).

**Packaged Alpha.3 recommendation:** **NO-GO** until `alpha3-release-validation` is green; then **GO** for pre-release only (unsigned preview).
