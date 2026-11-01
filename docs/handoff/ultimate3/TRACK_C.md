# Track C: portable workspaces, observed windows and signed Firefox installation

Branch: `feature/ultimate3-profile-firefox-workspaces`, based on PR #5 at
`09d25c46215113bdf33ad7718eea041c3e0adde3`. Tracks A and B are preserved as separate
branches; this checkpoint does not merge them or alter either historical scorecard.

## Implemented behavior and acceptance boundaries

| Feature | Delivered | Still required for VERIFIED |
|---|---|---|
| M8 | Existing encrypted portable v2 and streaming format retained; complete multi-profile workspace snapshots use dependency maps and one recoverable filesystem/SQLite operation. Single-profile restore can target an accessible workspace. Both Windows Chromium and Firefox UI export → fresh install → cookie/localStorage readback → application restart/readback passed at `2549682`. | Additional bookmarks/session/extension-settings readback, large-profile Windows load and installed Windows 10 qualification. OS-bound credentials remain explicitly unsupported across machines unless independently demonstrated. |
| M12 | Observe Win32 window placement or X11 window manager state; Chromium CDP fallback reads actual browser bounds. Persist validated bounds and maximized state atomically, retain normal bounds, allow negative monitor coordinates, and fall back to a connected display. Track while running and save before shutdown. Chromium Win32 restart acceptance passed at `2549682`. | Corrected Firefox launcher/browser identity needs Windows requalification; physical multi-monitor disconnect and mixed-DPI qualification. Wayland/macOS window observation is not implemented. |
| M14 | Confirmed permanent install/removal via Firefox Marionette AddonManager; bounded XPI/CRC/path validation; unsigned rejection; enforce Mozilla signing preferences; verify session profile/PID, persisted signed/active state and installed-file SHA-256 before reporting success. UI exposes actual install/remove. | Genuine signed XPI install → restart → availability → isolation → removal in real Firefox. Signature metadata alone is never proof; Firefox performs Mozilla trust-chain and compatibility validation. Enable/disable still uses Firefox's own add-on UI. |
| M38 | Complete encrypted workspace export/import with browser files, secrets, dependencies, shared-ID remapping and atomic rollback. Membership changes use SQLite writer transactions; recovery locks and optimistic edit revisions prevent conflicting changes. Real Windows UI export/restore/restart passed at `2549682`; optional authenticated HTTPS snapshot sync. | Corrected writable Windows flush handle needs requalification; independent devices against a deployed, authorized relay. Local two-process TLS tests are not cloud-team qualification. |

All four remain **PARTIAL** until their complete gates pass. Original score remains
18 VERIFIED / 20 PARTIAL / 5 UNSUPPORTED / 2 NA: `(18 + 0.5*20)/43 = 65.1%`.
No Track C feature promotion and no change to the fixed 42-group checklist. The
separate A/B candidate promotions are not credited on this branch. M42 remains
unsupported as a CAPTCHA-free guarantee.

## Reproducible qualification

- `npm run test:trackc`: 18 source/protocol/API/database/TLS tests, including two
  independent local app processes, encrypted relay storage, reader/writer ACLs,
  concurrent revision conflict rejection, fresh restore and restart.
- `npm run test:data-recovery`: existing crash, integrity, rollback, purge and
  streaming regressions. No recovery assertion was removed.
- `npm run test:m4`: WebRTC policy/API/launch-boundary regressions. Fixed stale
  fixtures to create real database rows and expect all pending migrations and
  the existing restored-extension launch behavior; policy assertions remain.
- `npm run test:trackc:acceptance`: six real-browser/desktop/UI gates, with no new
  skips. Requires Chromium, Firefox, a desktop/window manager, and a real signed
  XPI in `PM_SIGNED_XPI` with `PM_SIGNED_XPI_SHA256`.
- `node scripts/qualify-trackc.mjs`: complete source/browser/security/API/UI
  batch; keeps individual logs, exact commit and exit statuses, runs independent
  suites after a failure, and exits nonzero if any gate fails or times out.

Local results and blockers are in `evidence/track-c-linux.json`. Windows runs are
separate evidence. Baseline Windows run
[41174241314](https://github.com/qadeer-cyber/profile-manager/actions/runs/41174241314)
allocated a runner and passed native installation, unit and desktop tests. Its
API failure was the obsolete expectation that Delete immediately destroys data.
The repaired API test verifies Trash preservation and confirmed purge separately.

First Track C Windows run [41195278893](https://github.com/qadeer-cyber/profile-manager/actions/runs/41195278893)
at `2549682877f484d17f1e65fc2218dd314240565b` completed with failures, not green.
Its six real acceptance cases were **4 PASS / 2 FAIL / 0 SKIP**: both M8 engines,
Chromium OS window persistence and workspace UI passed; Firefox window identity
and signed-addon session identity failed. Unit 134, API 45, security 41 and UI 25
passed. Full counts and original log hashes are in `evidence/track-c-windows-first.json`.

Follow-up fixes close the encrypted-backup fixture's SQLite handle before removing
its disposable directory, create a fresh human-input CDP page to avoid Chromium's
startup navigation race, and open sync ciphertext for writing before Windows
FlushFileBuffers. Firefox now verifies the canonical profile and actual browser
PID through Marionette, or discovers a profile-owned launcher descendant for
manual launches. It retains the profile lock when failed launch cleanup cannot
prove the process stopped. Windows uses `-wait-for-browser`; Mozilla launcher or
signature security is never disabled. Headless sessions cannot overwrite observed
desktop geometry, and explicit start-maximized settings take precedence.
These source fixes require a new Windows run; the first run is not relabeled.

Second Windows run [41223556986](https://github.com/qadeer-cyber/profile-manager/actions/runs/41223556986)
at `c02f5b20d74a92c804a99d2ae6e2f14e2e5b21c0` passed all nine regression suites.
Real acceptance was **5 PASS / 1 FAIL / 0 SKIP**: signed Firefox installation,
restart, isolation and removal now passed; Firefox HWND observation still failed.
Mozilla's `gfxPlatform::IsHeadless` checks the presence of `MOZ_HEADLESS`, including
an empty value. Explicit headed launches now remove that variable from the child
environment. The parent environment is preserved. This needs Windows requalification.

The strengthened M8 gate now calls application Stop instead of pre-quitting
Firefox in the test. Production Stop requests a profile/PID-verified Marionette
quit or an owned native window close before forced termination. Failed termination
retains the running row, lock and data, reports an error, and supports explicit
retry; concurrent failed Stop calls cannot report success. The signed-XPI gate
now exercises the actual application Install/Remove controls and asks Firefox to
reject altered signed manifest bytes with valid ZIP CRCs. These stronger gates
are pending the next run; prior passes do not substitute for them.

The Track C Windows workflow runs only on this branch, with read-only repository
permissions. It pins the upstream signed uBlock Origin 1.75.0 XPI and its release
SHA-256; Firefox must independently accept its signature. It builds no installer,
publishes nothing and does not dispatch installer-smoke.

## Optional encrypted team snapshot relay

`scripts/workspace-sync-server.mjs` starts only when explicitly invoked with a
local `PM_SYNC_CONFIG` file. Required fields: `directory`, `keyFile`, `certFile`,
and `principals`. Each principal contains `tokenSha256` (SHA-256 of a randomly
generated 32-byte base64url device token) and `workspaces`, mapping an exact UUID
to `reader` or `writer`. Optional `host` defaults to loopback; `port` to 7443.
Use a trusted TLS certificate and protect configuration/private keys on the host.
No service has been deployed by this checkpoint.

Clients supply the HTTPS origin, channel UUID, device token, local encryption
passphrase and explicit confirmation in Workspaces → Synchronize. Push requires
the current remote revision (zero only for a new channel); conflicting writes
return 409. Pull always restores a separate local workspace with ID remapping.
This is explicit snapshot synchronization, not automatic multi-writer merging.
The relay never receives the passphrase or decrypts profile data. Tokens and
passphrases are not persisted by the UI. TLS certificate verification is never
disabled; custom certificate authorities use the explicit `PM_SYNC_CA_FILE`.

Transfers retain existing PMBE AES-256-GCM authentication and bounded streaming:
4 GiB per file, 8 GiB payload, 9 GiB container, 100 profiles per workspace, two
concurrent transfers. The relay enforces reader/writer ACLs, compare-and-swap
revisions and storage quota, counting retained interrupted uploads. It stores
immutable ciphertext before committing its SQLite pointer. Failed/old objects
are retained for explicit administrative review; no automatic destructive retry.

## Integration with PR #6 and PR #7

Heads inspected: Track B `9ffd7f12c9466c145aec65bee721b360fad63b05`; Track A
`662131e2953cd8c3cd8ae90a9251a1b6b31fc38c`.

| Surface | Reconciliation required |
|---|---|
| `package.json` (A, B, C) | Keep the union of test scripts. No Track C dependency or lockfile change. |
| `server/app.js` (B, C) | Keep B's automation-attach/traffic routes and C's encrypted workspace/sync/Firefox install routes, including authentication, confirmation and recovery guards. No route names collide. |
| `server/browser-runtime/firefox-launch.js` (A, C) | Manually preserve A's `firefoxProcessEnv` extraction and C's mandatory signing preferences, explicit headless flag, launcher wait and verified browser PID selection. |
| `test/human-input.test.js` (B, C) | Preserve B's Firefox WebDriver coverage and C's fresh Chromium target/owned fixture cleanup. Keep input-value assertions in both engines. |
| Migration 19 (B) | C adds no main-database migration. Relay SQLite has an independent database. B's new `proxy_traffic_policies` and sessions are NOT yet portable dependencies: explicitly map policies before claiming combined backup completeness; measured session history needs an explicit retention contract. Older C builds correctly reject unsupported future-schema portable archives. |
| CLI (B) / encrypted transfer (C) | Existing profile endpoints remain compatible. CLI still needs workspace snapshot/sync commands with explicit passphrases/confirmations; do not send secrets in URLs. |
| Automation sessions (B) / Firefox add-ons (C) | Both may own Marionette. Serialize management sessions; an occupied session currently returns an error rather than displacing another client. Test reconnect and installed-extension restart together. |
| Scores and tests | Keep A/B claims separate until integration acceptance. No historical matrix overwritten by C. Run all three suites plus recovery/API/browser gates after authorized integration. |

Recommended integration order after owner authorization: baseline → A → B → C,
then explicit portable proxy-policy mapping and combined browser acceptance.
No merge, cherry-pick or rebase was performed here.

## Owner Windows smoke report

`evidence/owner-windows-smoke-2026-10-31.json` records the reported Chrome for
Testing 156.0.8078.4 Google search for “hi”, visible AI Overview, no CAPTCHA in
that test, and matching SOCKS5 observed IPv4. Source commit and exact addresses
were not supplied. This does not establish persistence, WebRTC/DNS/IPv6 leak
protection, full Windows acceptance or M42 verification. Next qualification order:
profile restart/readback, WebRTC candidates and controlled DNS/proxy routing,
then full Windows application acceptance.
