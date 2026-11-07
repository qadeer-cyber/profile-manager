# Azwah Ultimate UI — source audit and preservation matrix

Audit date: 2026-11-07. Base: `feature/azwah-office-edition` at `075d2a4791bfd482ef63c5b221bb3c8c39950714` (same commit on origin and draft PR 10). Integration branch: `integration/azwah-ultimate-ui-release`. No existing branch, release, or user database was rewritten.

## Branch relationship

| Line | Commit | Relationship to the verified office commit |
| --- | --- | --- |
| `feature/azwah-office-edition` / PR 10 | `075d2a47` | Verified tip. This work starts here. |
| Track C `feature/ultimate3-profile-firefox-workspaces` / PR 8 | `a948841` | Ancestor of `075d2a47`. No commits exist on Track C that are missing from office. |
| `integration/ultimate3-unified` | `fb0a597` | Also an ancestor. Not re-merged. |
| `main` | `281b0b2` | Not the base of this branch and not a merge target. |

Screenshot identities, email addresses, workspace ids, and proxy credentials from the layout references are not stored as defaults, fixtures, or sample values.

## Preservation matrix

| Area | Backend today | UI after this change | Persistence | Left unchanged |
| --- | --- | --- | --- | --- |
| Profile lifecycle | SQLite profiles, launch, stop, clone, trash, restore, purge | Dashboard table calls the same APIs | `profiles` rows and user-data directories | Schema and license identity |
| Quick profile | `POST /api/profiles/quick` | Toolbar Quick | `is_quick` | Save-as-regular action |
| Engines | `chromium` and `firefox` | General engine select | `browser_engine` | Native launch plans |
| Proxy protocols | `http`, `https`, `socks5` | One line plus protocol segments | Encrypted password column | `cleanProxy` keeps `••••` as “unchanged” |
| Proxy line `host:port:username` | Previously rejected | Accepted as username and empty password | Empty password, not a generated one | URL form still percent-decodes; colon form stays literal |
| Proxy test | `POST /api/proxy/test` and library test | Test Proxy uses that same body or saved id | Last test fields on library proxies | Result is transport status, egress, latency. Not a browser-leak claim |
| Templates | Instantiate API | Template segment creates a live proxy, then assigns it | Library row | Templates are still not assigned directly |
| Region | Locale, IANA timezone, languages, Firefox session mode | Fingerprint tab | `browser_settings` | Masked-from-proxy-IP timezone is not offered |
| WebRTC | Five Chromium policies, Firefox `user.js` mapping | Same select | `webrtc_settings` | No off switch and no spoofed address |
| Geolocation | default / ask / allow / deny, coordinates only with allow | Same fields | `advanced_settings` | Native launch does not apply the coordinate override |
| Screen | Window presets and custom bounds | Same fields | `advanced_settings.screen` | Does not spoof screen APIs |
| User agent | default / reduced / full for the real Chromium | Same select | `advanced_settings.userAgent` | Free-form UA still rejected |
| Fingerprint | WebGL default or restricted; fonts and media real or restricted; canvas, audio, port scan fixed real | Same selects, plus explicit unavailable rows | `advanced_settings.fingerprint` | Noise, masked GPU, navigator, and WebGPU metadata stay rejected |
| Canvas / WebGL prototypes | Opt-in page hooks, Playwright session only | Same selects and the existing warnings | `experimental` | Not described as noise or a CAPTCHA bypass |
| Extensions | Chromium unpacked assignments; Firefox signed/unpacked on the Extensions page | Extra tab and Extensions page | Extension tables and profile dirs | Cookie-Editor still requires the official store confirmation on Chromium |
| Cookies, localStorage | Existing cookie manager and browser profile dirs | Extra tab | Profile user data | No new storage format |
| Backup | Encrypted `.pmp` / workspace backup | Row export and Settings backup | AES-256-GCM | Passphrases are not logged |
| Workspaces | Local workspaces, vault, encrypted sync | Sidebar and General select | Existing workspace tables | No cloud workspace was added |
| Folders and tags | String folder, tag array, bulk assign | Sidebar counts from `/api/meta`, table, bulk tools | Profile columns | Nested folders are not stored |
| Favorites | Not implemented | Disabled control with that reason | None | No fake star state |
| Team, billing, cloud storage | Not implemented | Omitted as actions. Sidebar states they are absent | None | No subscription UI |
| Automation | CDP, WebDriver, geckodriver, human input, CLI | Row action and Settings panels | Existing flags | CookieRobot remains Chromium-only |
| Owner edition | `owner-personal`, activation not enforced | Edition pill and Settings | No activation file | No signing key in the owner package |
| Office edition | Device-bound Ed25519 verification | Existing activation screen, heading text kept | `azwah-activation.json` | Private issuer key stays out of Owner and Office payloads |
| Admin | GUI org, vault, issue, reissue, Office installer generation | Unchanged Admin screens; Office payload is rebuilt from this UI in CI | Admin vault on the admin machine | `azwah-license-admin-experimental.1` is not replaced |
| Themes | `localStorage` `pm.theme` light / dark / system | Top bar and Settings | Browser local storage | Not a server setting |
| Table preferences | Server filters, sort, paging, saved views | Client column visibility and page size in `pm.profileTable` | Saved views remain server-side | Default page size in the UI is 10; the API default is still 50 |
| Restart | No dedicated route | Stop then launch for one running selection | Same launch records | Not offered as a separate backend feature |

## Reference layout versus this build

The seven reference images are interaction targets only. Branding is the existing Azwah mark. The shell is a light top bar, profile sidebar, dense table, and a wide editor with General, Proxy, Fingerprint, and Extra. Update and Cancel stay in the editor footer. The overview reads the form state and never shows a password. Storage is labeled Local.

Controls that the reference shows but this repository cannot apply are visible as unavailable text: favorites, nested folders, team, subscriptions, masked timezone, masked geolocation coordinates, navigator replacement, WebGL metadata replacement, canvas noise, audio noise, and port-scan masking.

## Follow-up inventory requested after the checkpoint release

The checkpoint installers did not type into the Custom proxy field, and the proxy screenshot was taken with None selected. A malformed line could also leave the last valid proxy in the form and still save. The editor now refuses to save while that line does not parse.

| Control | What the code actually does |
| --- | --- |
| Favorites | No database column and no API. The star and sidebar entry stay disabled and say they are not stored. |
| Folders | Flat profile labels with counts, search, and creation when a profile is saved. Nested folders are not stored. |
| Tags | Stored on the profile and applied through the bulk job API. |
| Delete and restore | Trash keeps the row. Restore returns it. Permanent delete requires the typed name. |
| Column prefs | Browser `localStorage` key `pm.profileTable`. Not a server setting. |
| Bulk | Launch, stop, tags, move, proxy, and delete jobs exist and the toolbar calls them. |
| Chromium payload | `extraResources` copies `build/bundled-browsers` to `resources/browsers`. |
| Firefox payload | Official unmodified Mozilla Firefox ESR 140.17.0 win64 is staged from the published installer `df6f7046d53ff17403e49092c0fe830e24cabd8dacbfad3225870955908fccf9` and copied to `resources/firefox`. MPL 2.0 and the source tarball URL are shipped beside it. Packaged launches do not search Program Files. |

## Verification limits recorded with the audit

- Linux unit coverage can check the proxy parser and the existing security suite. It cannot qualify an NSIS install.
- Windows CI for this branch runs on `windows-2022`. That is not Windows 10 and not the i5-7300U / 8 GB / HD 620 target.
- Until that job is green and its uploaded EXE hashes match the downloaded bytes, there is no Ultimate release claim.
- Prior Owner, Admin, and Office run evidence is historical context. It is not reused as a pass for this UI.
