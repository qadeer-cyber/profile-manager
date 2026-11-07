# Ultimate UI mission checklist

Branch: `integration/azwah-ultimate-ui-release`
Baseline: `075d2a4791bfd482ef63c5b221bb3c8c39950714`
Main is not a merge target. Existing release tags `azwah-multi-browser-owner-experimental.1` and `azwah-license-admin-experimental.1` are not updated.

| Phase | State | Evidence |
| --- | --- | --- |
| 1 Source audit and preservation matrix | Written in this directory | `AUDIT-AND-PRESERVATION.md` |
| 2 Dashboard, editor, settings | Implemented and exercised in headless Chrome against the local server at 1366x768 and 1600x900. That run is not an installed Windows test | `web/src/App.jsx`, `ProfilesPage.jsx`, `ProfileDialog.jsx`, `SettingsPage.jsx`, `style.css` |
| 3 One-line proxy | Parser tests passed. A Linux server smoke saved `socks5` `203.0.113.10:1080` username `alice` and an empty password. No installed-browser route check yet | `server/proxy-line.js`, `test/proxy-line.test.js` |
| 4 Fingerprint and Extra | Existing controls moved under Fingerprint and Extra. Unsupported reference modes are described as unavailable | `ProfileDialog.jsx`, `ProfileAdvanced.jsx` |
| 5 Owner and Office behavior | Same activation module and package metadata. Owner still has no employee gate | `server/office/activation.js` unchanged aside from no edit |
| 6 Admin Office payload | CI rebuilds `electron-builder.office-payload.cjs` into the new Admin installer | `.github/workflows/azwah-ultimate-release.yml` |
| 7 Installed Windows acceptance | Green on Windows Server 2022 for run `42386106277`. Owner suite 40 pass / 0 fail. Admin and generated Office suite 18 pass / 0 fail. These are separate suites | Artifact `ultimate-owner-79b262b4f99579d83c3c21545f648260b23e1229` |
| 8 Release upload and download hash | Both prereleases published. Independent download matched the published SHA-256 and byte size for each EXE | Not a Windows 10 or final-production claim |

## Verified releases

- Owner: https://github.com/qadeer-cyber/profile-manager/releases/tag/azwah-multi-browser-ultimate-79b262b4f995
- Admin: https://github.com/qadeer-cyber/profile-manager/releases/tag/azwah-license-admin-ultimate-79b262b4f995
- Source SHA: `79b262b4f99579d83c3c21545f648260b23e1229`
- Owner EXE `Azwah-Multi-Browser-Ultimate-Setup-x64.exe`: 349516285 bytes, SHA-256 `ebcef481de6af1ca9acbfaafa499a3e740df8f9208a0fc1e2021bc65b5ff904e`
- Admin EXE `Azwah-License-Admin-Ultimate-Setup-x64.exe`: 462390721 bytes, SHA-256 `2a356c4c9390891885c914866801d6ff1ac1f3e63cc951b1627edbf9114015c9`
- Authenticode: NotSigned
- Installed screenshots are in Actions artifact `ultimate-owner-79b262b4f99579d83c3c21545f648260b23e1229`, directory `screenshots/`, for dashboard, general, proxy, fingerprint, extra, and settings light/dark at 1366x768 and 1600x900.

The installed proxy screenshot was taken with None selected, so that frame does not show the one-line field. The one-line parser was verified by Linux unit tests and a local server save. The installed Owner and Office jobs routed a real HTTP proxy through Chromium.

## Explicit non-claims

- Windows 10 / HD 620 hardware was not available without new paid infrastructure or the owner's computer.
- Favorites, nested folders, team accounts, subscriptions, and cloud storage are not implemented.
- Canvas noise, audio noise, WebGL metadata replacement, navigator replacement, and WebRTC disable/spoof are not implemented.
- A passing proxy transport test is not a statement that every browser surface uses that proxy, and it is not an anonymity result.
