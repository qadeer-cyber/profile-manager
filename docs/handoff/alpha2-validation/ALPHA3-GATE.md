# Alpha.3 gate — preparation only

Decision: **NO-GO**. Do not publish alpha.3, do not merge to `main`, and do not build an installer from this pass.

| Gate | Result |
|---|---|
| M2 E4 closed | **Yes, on Linux.** See `E4-EVIDENCE.md`. 60 s idle, restart, stale-lock cleanup, and the auth/error contract have command output. |
| Regressions on the integrated tree | **Green on the re-runs that matter.** Unit 134/134, diagnostics live 12/12, diagnostics gate 10/10 after `ss` was installed, diagnostics UI 54/54 after the pill-case fix, engine and lifecycle exit 0, M3–M9 unit suites exit 0. The first gate run and the first UI run failed for the reasons in the evidence file. Those failures were re-run clean. |
| Real Windows evidence | **Missing.** This host is Linux. `scripts/windows-smoke/Start-Smoke.ps1` is written to exit 2 with `Execution: BLOCKED` off Windows. No Windows 10/11 install was performed. |
| Critical Windows defects fixed | **Not verifiable here.** No P0 was reproduced. Windows DPAPI cookie decryption, `taskkill /F` classification, and the Windows debugging-port check stay open. |
| Migration and data preservation | **Linux only.** Unit test “upgrade from 0.5.0-alpha.1 schema 10 keeps profiles, proxies, secrets, and Chrome user-data” passed. Engine upgrade v0 → v12 kept the legacy profile. A real alpha.1 EXE → alpha.2 EXE upgrade on Windows was not run. |
| QA handoff of known limits | **Written.** Unsigned EXE, SmartScreen expected, no fingerprint or zero-WebRTC-leak claim, `unsupported_encryption` for non-Linux cookie blobs, uninstall keeps `profiles.db`, Linux green is not Windows readiness. |

## Known limits QA must repeat

- The alpha.2 EXE SHA-256 is `053447b2b6f024a238fca478626601dbdf7b9abc95e06864995495b57cad45e4`. The alpha.1 EXE SHA-256 is `98a6444d744876b7689db5e67e1fc22a121946ebac0003af6c43ad394ecd848d`. Both tags were left untouched.
- Chromium pin is 156.0.8078.4. That was launched on Linux. It was not launched from the installed Windows EXE in this pass.
- WebRTC diagnostics describe an allowlisted command-line policy. They do not prove the absence of a leak.
- An unencrypted backup contains `secret.key`. An encrypted backup requires the passphrase and must not be logged.

## What would flip this to GO

1. `summary.json` from `scripts/windows-smoke/` on Windows 10 x64 (Latitude 5480 or equivalent) and Windows 11 x64, with every scenario id `PASS`, hashes matching, and `-AllowDestructive` used for install, upgrade, backup restore, and uninstall.
2. Those runs show migrations 10, 11, and 12, the alpha.1 profile still present, Chromium 156 launching and stopping, and `profiles.db` still on disk after uninstall.
3. No new P0/P1 from that evidence. Cookie DPAPI behavior recorded as either a successful round-trip or an explicit `unsupported_encryption`, not a guessed plaintext.

Until that zip exists, alpha.3 stays NO-GO.
