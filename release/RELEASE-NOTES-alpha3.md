# Profile Manager v0.5.0-alpha.3 — Local Windows Preview

**Pre-release only.** Single-user, offline-first local desktop. No cloud accounts, teams, or subscription.

## What changed since Alpha.2 (M10–M17)

- Advanced Monitoring (process tree, working set on Windows via CIM where available)
- Launch metrics, queue, and resource monitoring (M12)
- Parity scorecard and privacy-engine reporting APIs (M14–M16)
- Crash/orphan recovery, stale lock sweep, Chromium install rollback (M17)
- GitHub Actions **windows-2022** validation job (`m17-windows-validation`, Alpha.3 release validation)

## Install identity (unchanged from Alpha.2)

- App id: `local.profilemanager.app`
- Per-user install under `%LOCALAPPDATA%\Programs\Profile Manager\`
- Profile data: `%APPDATA%\profile-manager\` (preserved on uninstall and on Alpha.2 → Alpha.3 upgrade)

## Honest limits (read before use)

- **Unsigned EXE** — SmartScreen warnings expected.
- **Stock Chromium** — Multilogin-style canvas/WebGL **mask/noise** is **not** supported; see `FINGERPRINT_PARITY_MATRIX.md`.
- **Google Search / CAPTCHA** — Not guaranteed; often proxy reputation + automation-visible client shape. See `docs/handoff/alpha2-validation/CAPTCHA-ANALYSIS.md`.
- **Validation host** — CI uses GitHub **Windows Server 2022**, not Dell Latitude 5480 / Intel HD 620.
- **Alpha.1 / Alpha.2 releases** — Left unchanged on GitHub.

## Verify download

```powershell
Get-FileHash -Algorithm SHA256 .\Profile.Manager-offline-Setup-0.5.0-alpha.3-x64.exe
```

Compare with `SHA256SUMS.txt` in this release.
