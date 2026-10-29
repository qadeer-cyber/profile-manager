# Release qualification GO/NO-GO (M17 → Alpha.3)

**Branch:** `feature/m10-local-parity`  
**Validated commit (release):** `2d65207ca5f7d43436e35fe5f16fce8d7d0dd002`  
**Alpha.3 pre-release:** https://github.com/qadeer-cyber/profile-manager/releases/tag/v0.5.0-alpha.3-m1-m17  
**Release CI run:** https://github.com/qadeer-cyber/profile-manager/actions/runs/40912137853  

| Gate | Status | Evidence |
|------|--------|----------|
| M10–M17 regressions (Windows) | **PASS** | Step `M10–M17 regression` in release run |
| Win32 CIM + concurrent profiles | **PASS** | `test:m17-windows-ci` in release run |
| Electron source smoke | **PASS** | `test:electron` in release run |
| Alpha.3 offline EXE build | **PASS** | `Profile.Manager-offline-Setup-0.5.0-alpha.3-x64.exe` |
| Alpha.2 → Alpha.3 data preservation | **PASS** | `test/electron-smoke-alpha3-upgrade.js` (DB + profile dir) |
| Clean install + offline app smoke | **PASS** | `test/electron-smoke-offline.js` in release run |
| Uninstall preserves `profiles.db` | **PASS** | Release job uninstall step |
| Physical Latitude / HD 620 | **BLOCKED** | GHA Hyper-V Video only |
| Multilogin mask on stock Chromium | **UNSUPPORTED** | Track B docs; not in Alpha.3 RC |
| GitHub pre-release published | **PASS** | Tag `v0.5.0-alpha.3-m1-m17` + assets |

**Local product parity:** **88.9%** (16/18 credits; weights unchanged).

**Packaged Alpha.3 recommendation:** **GO** for **unsigned pre-release preview** on windows-2022–validated bits. **NO-GO** for claiming Latitude-class hardware parity or Multilogin antidetect parity.
