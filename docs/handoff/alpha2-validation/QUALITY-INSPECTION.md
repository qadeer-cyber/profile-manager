# Professional quality inspection — alpha.2

Inspection only. No visual redesign.

## Release identity

- Product name: Profile Manager.
- App id: `local.profilemanager.app`.
- Version on this branch: `0.5.0-alpha.2`.
- Installer: NSIS, current user, directory choice, desktop and Start Menu shortcuts, `deleteAppDataOnUninstall: false`.
- Offline artifact name pattern: `Profile Manager-offline-Setup-${version}-x64.exe`. The published GitHub assets use dots in `Profile.Manager-offline-Setup-...`. The smoke runbook uses the published names.
- No Authenticode signature and no custom icon. Both are known limits, not new defects.

## Workflows that are in good shape

- Navigation covers Dashboard, Profiles, Proxies, Extensions, Settings, and Diagnostics. Loading and empty states exist on profile diagnostics (`Requesting observation…`, `No observation yet`).
- Errors from diagnostics use a fixed code list and short messages. Malformed bodies are discarded instead of rendered.
- A stopped profile, a superseded launch, and a stale `validUntil` are labeled in the diagnostics panel. The stale label appears from the 30 second display ceiling without another fetch.
- Dashboard refreshes counts on a 5 second timer. Saved views and bulk jobs are database-backed.
- Cookie import is refused while the profile is running. Backup creation refuses a passphrase unless `encrypt: true`.
- Single-instance lock, crash log, and a bounded backend restart are in the Electron main process.

## Release blockers (not polish)

- No human Windows 10/11 install or upgrade evidence.
- M2 case 5 (`taskkill /F`) and the Windows debugging-port check are still open.
- Cookie values created by Chromium on Windows are not decrypted (see the security note). The UI must keep showing `unsupported_encryption` rather than a blank success.

## Fixed during this inspection

Diagnostics status chips inherited `.pill { text-transform: lowercase }`, so “Versions match”, “Version mismatch”, and “Unavailable” rendered in lowercase and failed three UI acceptance steps. `.pd .pill` now keeps the component’s own wording. Other pills are unchanged.

## Optional polish (do not block alpha.3 once Windows evidence exists)

- The Diagnostics page shows the raw data-directory path. That matches the preserved health endpoint. Hiding the user name would be polish, not a contract change.
- No application icon.
- Dependency `npm audit` findings were left untouched.
- The global health poll on the Diagnostics page is noisier than it needs to be. It does not collect browser facts.

## Not claimed

Fingerprint resistance, anonymity, and a guarantee of zero WebRTC exposure are out of scope. The product copy and the diagnostics contract already refuse those claims. This inspection did not add any.
