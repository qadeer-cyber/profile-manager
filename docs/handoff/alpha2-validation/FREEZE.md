# Alpha.2 freeze — 2026-10-28

Owner: Mohammad Abbas. Work is on `feature/alpha2-validation-hardening` only. No pull request, no merge to `main`, no installer rebuild, no new GitHub release, no force-push.

## Frozen release

| Item | Value |
|---|---|
| Repository | `qadeer-cyber/profile-manager` |
| Branch tip at freeze start | `1e1a957e9f40f9a3e8a8bd02d4a3ddc256914c95` |
| Tag | `v0.5.0-alpha.2-m1-m9` (annotated tag object `cc13541e0c99c351b1da89a7217ff1aae33c0a1c`, peels to `1e1a957e9f40f9a3e8a8bd02d4a3ddc256914c95`) |
| Package version | `0.5.0-alpha.2` |
| EXE | `Profile.Manager-offline-Setup-0.5.0-alpha.2-x64.exe` |
| EXE size | 349611648 bytes |
| EXE SHA-256 | `053447b2b6f024a238fca478626601dbdf7b9abc95e06864995495b57cad45e4` |
| Prior tag | `v0.5.0-alpha.1-m4-m5` peels to `e2469b15a3b72f0ffa2a5997043748ff90e2b29a` |
| Prior EXE SHA-256 | `98a6444d744876b7689db5e67e1fc22a121946ebac0003af6c43ad394ecd848d` |

Those tags and assets were not modified. The GitHub release API lists `targetCommitish` as a branch name (`feature/m8-m9-professional-parity` for alpha.2, `main` for alpha.1). The tag peel above is the commit.

## What alpha.2 already contains

M1 through M9 are in this commit: lifecycle, diagnostics, regional settings, WebRTC policy, extensions, advanced settings, cookies, backup, bulk operations, dashboard, saved views, encrypted backups, and provider adapters. Schema head is migration 12. Chromium is pinned at 156.0.8078.4 (Playwright revision 1248).

Packaging and Chromium sanity on a desktop build host were accepted for the alpha.2 release. Install on a real Windows 10 or Windows 11 machine was still unverified at this freeze. Linux test results do not close that gap.

## Preserved, not rewritten

- M1–M9 behavior and the alpha.1 tag.
- DiagnosticsV1 contract hashes: original `cd1ce49f379566efa0fa65ed81f5402f21259191cbdb6aa6088eb8413b8059d8`, process-command-line amendment `e80ce2d513e610a18c703b775fb0fd5520e3eb1ca5dce6f4ad43a1eecf08bdf4`, addendum A1 `6290869be994956f48c4576c63fe271e63fb63a3c4689d1b1659f9dae703add4`.
- `deleteAppDataOnUninstall: false`, app id `local.profilemanager.app`, data directory `%APPDATA%\profile-manager`.

## Open at freeze

- M2 E4: 60-second no-polling, no observation cache across restart, stale `.pm-lock` cleanup. The scaffold todo was still open. Source-sign-off rows E1, E6, E11, E13, S8 had executing tests on an earlier disposable tree and are in this integrated tree.
- Windows 10/11 install, upgrade from alpha.1, DPAPI, and `taskkill /F` classification (e2e case 5).
- Windows half of “no extra debugging TCP port.”
- Alpha.3 is not authorized to publish.

## Acceptance still required before any alpha.3

1. E4 evidence from this branch (commands, outputs, commit).
2. Regression suites on the integrated tree, separate from a Windows pass.
3. Human Windows 10/11 evidence from `scripts/windows-smoke/`.
4. No open P0/P1 that loses profile data, leaks a credential, or breaks migration 10→11→12.
5. A written list of limits that QA must not over-claim (no “undetectable fingerprint”, no “zero WebRTC leak”).
