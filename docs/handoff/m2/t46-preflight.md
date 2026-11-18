# t46u pre-merge verification (DISPOSABLE, local only — never pushed)

- Phase 1 B1 closeout: **BLOCKED**. `test/regional-locale-diagnostic-negative.test.js`
  test 1 fails reproducibly: after a diagnostic-tab locale failure the quarantined
  tab, once reloaded (Page.reload = browser reload path), executes script with
  `en-US` (native locale `de-DE` never applied). Pre-reload the tab is paused
  (navigate/evaluate time out); typed navigation after reload stays pending (no
  HTTP hit, no page beacon). Manual close / leak / lock / timeout checks pass.
  Test 2 (injected 3 s timeout) passes: 3004 ms, `unavailable:timeout`, lifecycle
  and last_error unchanged, next POST de-DE.
- Phase 2 B4: assertion unchanged; cannot run with real objects on this box (no
  git credentials, private repo; disposable tree has synthetic history). Remote
  GitHub API confirms d7a000e tree has no server/diagnostics.js, app.js has no
  `profiles/:id/diagnostics` and has `ui.get('/diagnostics'`, and 281b0b2 is 18
  ahead / 0 behind d7a000e. Executed count stays 53 pass / 1 fail / 1 todo.
- Phase 3: `test/diagnostics-gate.live.test.js` 5/5 (429 busy, §7.9 after success,
  case 2, §8 cleanup cycles, case 4, §10 no TCP port [Linux], case 6 + 409).
- Phase 4: `.github/workflows/m2-source-acceptance.yml` + `scripts/m2-source-acceptance.mjs`
  (not dispatched). Installer workflow byte-identical (blob c9a8e52).
