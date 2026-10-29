# Release qualification GO/NO-GO (M17)

**Product:** Profile Manager local desktop (`feature/m10-local-parity`).  
**Alpha.2 EXE:** UNTOUCHED — checklist only; no installer published from this milestone.  
**Evidence run (Windows native):** https://github.com/qadeer-cyber/profile-manager/actions/runs/40879417553  
**Validated commit:** `818e7cf28976fae32e98463bcf634fdb016e14dd`  
**Runner:** GitHub-hosted `windows-2022` — OS `Windows_NT 10.0.20348.0` (Windows Server 2022), **not** Dell Latitude 5480 / Intel HD 620 / physical Win10.

| Gate | Status | Evidence |
|------|--------|----------|
| M10–M17 source regressions on Windows | **PASS** | Job step `M10–M17 regression suites` — 46 tests, 0 fail ([run log](https://github.com/qadeer-cyber/profile-manager/actions/runs/40879417553)) |
| Win32 CIM process monitoring | **PASS** | `test/m17-windows-native-ci.test.js` — `source=win32_cim`, 8 CIM rows during concurrent launch |
| Concurrent headless profiles + monitoring API | **PASS** | Log `M17_WIN_CI concurrent=2`; launch/stop + `GET /api/v1/recovery-status` |
| Profile data preservation (isolated dir) | **PASS** | Marker file under profile userDataDir after stop; smoke uses isolated `PM_DATA_DIR` |
| Crash recovery unit coverage | **PASS** | `test/m17-crash-recovery.test.js`, `test/m17-launch-cancel.test.js` in regression suite |
| UI 1366×768 layout (built assets) | **PASS** | Playwright layout check in `test/m17-windows-native-ci.test.js` (no fake screenshots) |
| `Run-M17-Latitude5480.ps1` automated slice | **PASS** | Step `Run M17 Latitude smoke script` — `PASS automated M17 regression on Windows` |
| Chromium pin / lifecycle | **PASS** | Playwright Chromium install + lifecycle tests in regression |
| Installer upgrade preservation | **NOT TESTED** | `build_installers=false`; no new EXE |
| Physical Latitude 5480 / HD 620 GPU | **BLOCKED** | Runner GPU: `Microsoft Hyper-V Video` (VM), not HD 620 |
| Manual HD 620 / Advanced Monitoring RAM on real hardware | **BLOCKED** | Smoke script logs manual reminder only; not executed on target laptop |
| Multilogin mask/noise on stock Chromium | **OPEN** | Documented UNSUPPORTED — honest local product, not release blocker |
| P1: Windows stability scorecard row (physical) | **BLOCKED** | Needs Latitude-class hardware pass |

**Dispatch note:** `workflow_dispatch` from the Cursor GitHub App token returned **HTTP 403** (`Resource not accessible by integration`). Validation was triggered via **push** to `feature/m10-local-parity` using job `m17-windows-validation` (`m17_validation_only` equivalent). Owner can still dispatch manually from the Actions UI with `m17_validation_only=true`.

**CI infra:** Artifact uploads disabled (`if: false`) to avoid quota; evidence is job logs + `GITHUB_STEP_SUMMARY` only (no cookies/profiles/tokens uploaded).

**Overall release recommendation:** **NO-GO** for packaged Alpha release until physical Latitude validation and installer upgrade path are tested. **GO** for continued M17-qualified development on `feature/m10-local-parity` with **native Windows Server 2022 CI PASS** as documented above.
