# Stage 3 recovery checkpoint

Base: Codex f78d88a43ac7be03210275d18a1119bc0b593111. No merge performed.

## Source changes and local evidence

- Disk-backed AES-256-GCM portable v2 transfer with authenticated parsing, per-file SHA-256, bounded 128 KiB buffers, 4 GiB/member, 8 GiB payload, 9 GiB encrypted upload, 100,000 entries, two active transfers and disk-space checks. Existing small APIs and v1 readers retained. No truncation. Private spools may contain plaintext after authentication; interrupted spools remain visible for explicitly confirmed cleanup. They are never automatically removed at startup.
- Export UI streams to a user-selected file where supported; small download fallback is limited to 64 MiB. Restore uploads File directly. No secrets in URLs or command arguments. OS-bound Chromium credential decryption across computers is not promised.
- Recovery journal validation rejects corrupt/forged state, preserves locks/data and exposes diagnostics. Cleanup errors and partial state are reported. Nested browser files named lock are preserved.
- Verified Windows failure addressed: backup fixture closes SQLite before deleting its disposable directory. Fault-injection cases split into independent files without increasing their timeout or dropping assertions.
- Firefox native automation launch sets its actual selected Marionette port in managed preferences and enables Marionette. Test-only framed protocol client has independent socket tests.

Commands/results (Linux Node 24, disposable data only):

| Command | PASS | FAIL | SKIP |
|---|---:|---:|---:|
| npm run test:data-recovery | 62 | 0 | 0 |
| npm run test:stabilization | 90 | 0 | 0 |
| source subset, same six browser-file exclusions as Stage 2 | 142 | 0 | 1 |
| npm run test:unit | 132 | 2 | 0 |
| focused stream/API tests after final edits | 10 | 0 | 0 |
| PM_CANDIDATE_CLI=/tmp/pm-grok-stage3/pm-cli.mjs npm run test:integration:preflight | 1 | 0 | 0 |
| npm run test:m8:acceptance | 0 | 2 | 0 |

Build and git diff --check pass. Full-unit failures remain missing Chromium headless binary and unavailable Linux diagnostic process start identity. M8 real-browser tests fail explicitly because Chromium/Firefox binaries are unavailable; no skips added. The integration probe passes as a report generator and reports two blocked contracts, not integration success. The focused stream API test round-trips a 96 MiB file between independent installations.

Windows reproduction: npm ci; npx playwright install chromium; install stock Firefox; npm run build; npm run test:unit; npm run test:data-recovery; npm run test:browser-runtime; npm run test:m8:acceptance. The normal source workflow runs these; no installer dispatch.

## CI evidence and M8 gate

Codex https://github.com/qadeer-cyber/profile-manager/actions/runs/41057276902 failed: backup.test.js cleanup EBUSY on profiles.db and portable-recovery.test.js file lifetime 120000 ms. Browser regression never ran, so its CDP fix remains unqualified. Grok https://github.com/qadeer-cyber/profile-manager/actions/runs/41057497939 remains in progress at latest observation; job logs unavailable. No cancellation.

M8 remains PARTIAL. New real-engine acceptance covers create/configure/browse/stop/encrypted export/fresh restore/launch/cookie+localStorage/restart verification. Chromium also exercises actual application export/restore UI. Windows and actual Firefox/Chromium execution must pass before promotion. Same-host A→B does not demonstrate cross-machine OS-encrypted credentials. 96 MiB scalability is demonstrated; maximum-size and power-loss hardware qualification remain pending.

Historical Codex matrix unchanged: 18 VERIFIED, 20 PARTIAL, 5 UNSUPPORTED, 2 cloud-excluded; (18+0.5*20)/43=65.1%. User-provided Grok checkpoint: 22/16/5/2=69.8%. Observed newer Grok matrix claims 24/14/5/2=72.1%; not independently accepted here. Fixed feasible-local checklist remains 0/42 fully requalified, 42 incomplete, 3 blocked subset. No denominator or status promotion.
