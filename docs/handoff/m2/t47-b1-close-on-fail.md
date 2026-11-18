# t47u — B1 option (ii): close only the failed app-owned diagnostic tab (DISPOSABLE, local only — never pushed)

Owner decision t47u (Mohammad Abbas, 2026-10-28 PKT): permanent freeze rejected (reload
bypass → `en-US` script, t46u); option (ii) approved with one narrow §7.9 exception.

## Contract
- Addendum: `docs/handoff/m2/contracts/DiagnosticsV1.addendum-A1-locale-failure-close.md`
- SHA-256: `6290869be994956f48c4576c63fe271e63fb63a3c4689d1b1659f9dae703add4` (also in `contracts/SHA256SUMS.addendum-A1`)
- Unchanged: `DiagnosticsV1.original.md` `cd1ce49f…59d8`, `DiagnosticsV1.process-command-line.md` `e80ce2d5…dbf4`, `contracts/SHA256SUMS`.
- Owner-approved text (verbatim): "An application-owned diagnostic tab remains open after normal diagnostic collection. If native regional-locale initialization fails, the application must close only that failed diagnostic tab to prevent execution under incorrect locale settings."

## Product change
- `server/regional-locale.js`: on a post-startup top-level setup failure whose `targetId` is in the
  app's own `Target.createTarget` registry, the target is marked never-resume and closed via
  `Target.closeTarget` by that `targetId`; the diagnostic waiter rejects → `collection_failed`.
  If closure cannot be confirmed, falls through to M3 fail-closed (profile stop + `last_error`).
  Unknown/child/URL-only targets get no exemption.
- `web/src/components/ProfileDiagnostics.jsx`: `DISCLOSURE` unchanged; additional addendum note shown below it.

## Note on fault model
Closing the failed tab triggers M3's existing survivor re-validation. Under a persistent,
browser-wide `setLocaleOverride` fault the survivors also fail and M3 fail-closed stops the
profile (M3 protection preserved, not a bypass). Diagnostic-only tests therefore inject a
per-target (single-call) fault; the combined/race test keeps a persistent fault.
