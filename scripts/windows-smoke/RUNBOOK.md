# Windows 10/11 smoke — Profile Manager alpha.2

This package prepares a human run on Mohammad’s Dell Latitude 5480 (Windows 10 x64) or another Windows 10/11 x64 machine. A Linux shell cannot execute it. Until that machine returns `summary.json`, Windows execution is **BLOCKED**. A green Linux suite is not a Windows pass.

Do not rebuild the installer. Do not publish a release. Do not delete `%APPDATA%\profile-manager`.

## Installers (existing releases only)

| Release | File | SHA-256 | Bytes |
|---|---|---|---|
| [v0.5.0-alpha.2-m1-m9](https://github.com/qadeer-cyber/profile-manager/releases/tag/v0.5.0-alpha.2-m1-m9) at `1e1a957e9f40f9a3e8a8bd02d4a3ddc256914c95` | [Profile.Manager-offline-Setup-0.5.0-alpha.2-x64.exe](https://github.com/qadeer-cyber/profile-manager/releases/download/v0.5.0-alpha.2-m1-m9/Profile.Manager-offline-Setup-0.5.0-alpha.2-x64.exe) | `053447b2b6f024a238fca478626601dbdf7b9abc95e06864995495b57cad45e4` | 349611648 |
| [v0.5.0-alpha.1-m4-m5](https://github.com/qadeer-cyber/profile-manager/releases/tag/v0.5.0-alpha.1-m4-m5) at `e2469b15a3b72f0ffa2a5997043748ff90e2b29a` | [Profile.Manager-offline-Setup-0.5.0-alpha.1-x64.exe](https://github.com/qadeer-cyber/profile-manager/releases/download/v0.5.0-alpha.1-m4-m5/Profile.Manager-offline-Setup-0.5.0-alpha.1-x64.exe) | `98a6444d744876b7689db5e67e1fc22a121946ebac0003af6c43ad394ecd848d` | 349576670 |

Both files are unsigned. SmartScreen is expected. Do not turn the warning off.

Check the hash in PowerShell before any install:

```powershell
Get-FileHash -Algorithm SHA256 .\Profile.Manager-offline-Setup-0.5.0-alpha.2-x64.exe
Get-FileHash -Algorithm SHA256 .\Profile.Manager-offline-Setup-0.5.0-alpha.1-x64.exe
```

The values must match the table. If they do not, stop and do not install.

## What you need

- Windows 10 or Windows 11, 64-bit. The Latitude 5480 target is Windows 10 x64.
- Windows PowerShell 5.1 (or PowerShell 7).
- The two EXEs above, already downloaded. The script does not download them.
- Optional: `sqlite3.exe` on `PATH` if you want the script to read `schema_version`. It only runs `SELECT` and only when the database already exists.
- A few GB free. The offline installer carries Chromium 156.0.8078.4.

The script does not need Node, Git, or a rebuild.

## Run

From the repository root of `feature/alpha2-validation-hardening`:

```powershell
powershell.exe -NoProfile -File .\scripts\windows-smoke\Start-Smoke.ps1 `
  -Alpha2Exe C:\path\to\Profile.Manager-offline-Setup-0.5.0-alpha.2-x64.exe `
  -Alpha1Exe C:\path\to\Profile.Manager-offline-Setup-0.5.0-alpha.1-x64.exe
```

That command checks hashes and writes one text file per scenario. It does **not** install, upgrade, restore, or uninstall. Destructive scenarios are `SKIPPED-NEEDS-APPROVAL`. Overall status stays `INCOMPLETE`. Exit code 3 means “evidence started, human result missing.” Exit code 2 means the host is not Windows (`BLOCKED`).

Evidence lands in `%LOCALAPPDATA%\ProfileManager-Alpha2Smoke\<timestamp>\`:

- `summary.json`
- `schema-version.txt` (versions only, or a note that sqlite3 was absent)
- `01-fresh-install.txt` through `14-restart-crash-uninstall.txt`

User names, profile paths, and anything that looks like a password, token, or passphrase are redacted before those files are written. Do not add those values back.

## Human results

Do the steps printed in each scenario file. Then write `manual-results.json` with only the ids you actually finished:

```json
{
  "01-fresh-install": "PASS",
  "03-profile-userdata-preservation": "FAIL"
}
```

Each value is `PASS` or `FAIL`. Then re-run:

```powershell
powershell.exe -NoProfile -File .\scripts\windows-smoke\Start-Smoke.ps1 `
  -Alpha2Exe C:\path\to\Profile.Manager-offline-Setup-0.5.0-alpha.2-x64.exe `
  -Alpha1Exe C:\path\to\Profile.Manager-offline-Setup-0.5.0-alpha.1-x64.exe `
  -ManualResults .\manual-results.json
```

A scenario is not `PASS` just because the script ran. The script copies your word from `manual-results.json`. It does not click the product.

## Destructive scenarios

These change an install or a database: `01-fresh-install`, `02-upgrade-alpha1-to-alpha2`, `12-backup-restore`, `14-restart-crash-uninstall`.

They stay skipped until you add `-AllowDestructive`. That switch is the explicit approval. It still does not delete profile data by itself, and uninstall is expected to **keep** `profiles.db` (`deleteAppDataOnUninstall` is false). Take the backup in scenario 02 before installing alpha.2 over alpha.1. Restore the encrypted backup onto a spare copy, not over the only copy of the data.

```powershell
powershell.exe -NoProfile -File .\scripts\windows-smoke\Start-Smoke.ps1 `
  -AllowDestructive `
  -Alpha2Exe C:\path\to\Profile.Manager-offline-Setup-0.5.0-alpha.2-x64.exe `
  -Alpha1Exe C:\path\to\Profile.Manager-offline-Setup-0.5.0-alpha.1-x64.exe `
  -ManualResults .\manual-results.json
```

## Scenarios

1. Fresh install and first launch.
2. Upgrade alpha.1 to alpha.2, with a database backup taken first.
3. Profile directory and Chromium user data survive an application restart.
4. SQLite migrations 10, 11, and 12 are present, and alpha.1 profile rows remain.
5. Chromium 156.0.8078.4 launches and the profile stop terminates it.
6. Two profiles stay independent.
7. WebRTC policy is stored and applied on next launch. This does **not** prove the absence of a WebRTC leak.
8. Proxy host, authentication, and the in-app connectivity check. Record status only.
9. An extension assigned to one profile loads again after a restart.
10. DPAPI / `electron-safeStorage` still decrypts a proxy password after a restart. Do not record the password.
11. Cookie import and export. A Chromium DPAPI cookie value should surface as `unsupported_encryption`, not as guessed plaintext.
12. Encrypted backup rejects a wrong or missing passphrase, and a correct passphrase restores the test profile onto a spare copy.
13. Dashboard counts, a saved view, and one non-delete bulk edit.
14. Restart, one crash recovery, and uninstall that leaves `profiles.db` on disk.

## Return

Zip the evidence directory and send it back. Overall `PASS` is valid only when every scenario id in that zip is `PASS`, the hashes match, and `-AllowDestructive` was used for the four destructive ids. Anything else stays `INCOMPLETE`, `FAIL`, or `BLOCKED`.
