# Installed path probe 42391396496

Harness `c4a174a74ae4ef3b781e13dad23ad4f6950d5e7b`. Windows run: https://github.com/qadeer-cyber/profile-manager/actions/runs/42391396496

This probe did not build the unified installer and did not modify migration code. It installed the published Owner and Admin releases and asked those processes for their data directories.

## Measured Owner database

The acceptance harness had set `APPDATA` to `D:\a\_temp\azwah-path-probe-LVysU9\appdata`. The installed Owner process reported:

- `app.getPath('appData')`: `C:\Users\runneradmin\AppData\Roaming`
- `app.getPath('userData')`: `C:\Users\runneradmin\AppData\Roaming\azwah-multi-browser-owner`
- Renderer `userData` matched that directory
- `profiles.db` was present there (200704 bytes) and absent from the `APPDATA` override
- After a normal close there was no `profiles.db-wal` and no `profiles.db-shm`
- SHA-256 of that database: `45d8d4085abd5b6c9626f2d50caadb329e2cedeb32a6b19a2dea811a6d569edf`
- Rows read back: profile `Kept from Owner` / `migration-marker`, workspace `Kept workspace` / `migration-workspace`

`migrateUltimateData` was then called with that reported `appData`. It copied the owner data directory, left the source hash unchanged, and the copy contained the same profile and workspace rows. The probe conclusion for this failure is `test-path`: the harness opened a database path Electron does not use.

## Measured Admin directory

The installed Admin process reported `app.getName()` `azwah-license-admin` and `userData` `C:\Users\runneradmin\AppData\Roaming\azwah-license-admin`. No organization vault was created in this probe, so the vault file itself was not read. The current migration constant `Azwah License Admin` does not match this measured directory name.

## Installers used

These are the published experimental.1 releases, not a unified installer.

- Owner `Azwah-Multi-Browser-Full-Setup-x64.exe`: 349510442 bytes, SHA-256 `f2dd1aab70c54c5f8daf40c47b10f595eda1a21d58b2a7691fd6471a4e9aeb7a`, tag `azwah-multi-browser-owner-experimental.1`
- Admin `Azwah-License-Admin-Setup-x64.exe`: 462385372 bytes, SHA-256 `08949f0b1f065d8e71e8d624bc8881b95dc579cc238794e3cf9711577bd72bd9`, tag `azwah-license-admin-experimental.1`

Run `42390179877` did not retain its unified installer. Its only uploaded artifact was the 697-byte acceptance log.
