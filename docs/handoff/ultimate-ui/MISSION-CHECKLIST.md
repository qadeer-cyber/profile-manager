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
| 7 Installed Windows acceptance | Not run in the Linux workspace. The workflow installs the NSIS build on `windows-2022` and captures 1366x768 and 1600x900 screenshots | Job artifacts `ultimate-owner-<sha>` |
| 8 Release upload and download hash | The workflow creates a new prerelease tag per commit, downloads the EXE, and compares SHA-256 before leaving draft | Not a Windows 10 or final-production claim |

## Explicit non-claims

- Windows 10 / HD 620 hardware was not available without new paid infrastructure or the owner's computer.
- Favorites, nested folders, team accounts, subscriptions, and cloud storage are not implemented.
- Canvas noise, audio noise, WebGL metadata replacement, navigator replacement, and WebRTC disable/spoof are not implemented.
- A passing proxy transport test is not a statement that every browser surface uses that proxy, and it is not an anonymity result.
