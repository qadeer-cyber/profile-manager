# §23 final delivery outline (draft — not Multilogin-complete)

**Purpose:** Honest closure checklist for `feature/dedicated-browser-engine` when owner signs §19. This is **not** a claim of Multilogin parity or a percentage score.

## Remaining backlog reality (Oct 2026)

Most open matrix rows are **UNSUPPORTED** (stock browser limits), **BLOCKED** (custom Chromium, owner Latitude IPv6), or **NOT_APPLICABLE_CLOUD** (pools, cloud sync). Stock-implementable P1/P2 increments are narrowing; further work is mostly polish, platform-specific UX, or owner-run validation.

## 20-point delivery outline (local product)

1. **Native manual Chromium** — default path, no automation pipe; verified in runtime tests + installer smoke (when re-run).
2. **Stock Firefox gecko runtime** — separate profile tree, proxy/locale/timezone/WebRTC ICE prefs; marionette when automation on; no Stealthfox/custom patches claimed.
3. **Profile isolation** — per-profile data dirs, locks, crash/exit classification; M1 path.
4. **Profile config v2** — typed settings, JSON schema, validate API, engine-specific warnings.
5. **Proxy library** — HTTP/HTTPS/SOCKS5, auth relay, provider adapters (partial), assignment UX.
6. **WebRTC policy** — Chromium flags + Firefox gecko pref mapping; no “zero leak” marketing.
7. **Fingerprint controls (honest)** — only stock switches/prefs documented; noise/canvas UNSUPPORTED.
8. **Extensions (Chromium)** — unpacked library + launch args; Firefox assignments blocked in UI.
9. **Tab restore (native opt-in)** — harvest on stop/health, Startup UX, launch plan tests.
10. **Quick profiles + trash + templates + clone** — lifecycle APIs and UI.
11. **Workspaces (local)** — vault lock optional; no team cloud.
12. **Cookie import/export** — Chromium stopped SQLite (full); Firefox gecko **read/export** only (`gecko-cookies.js`).
13. **CookieRobot-local** — Chromium CDP jobs + integration test; Firefox rejected at create.
14. **Automation API** — `/api/v1`, bearer token, CDP when automation enabled.
15. **WebDriver + geckodriver bridges** — localhost only, opt-in driver cache, engine-specific start/stop.
16. **CLI (`pm-cli`)** — list/launch/stop/schema/config/bridges; examples under `examples/local-automation/`.
17. **Diagnostics + hardware/fingerprint consistency** — existing reports; no CAPTCHA bypass tooling.
18. **CfT update + rollback** — dual slot backup; Diagnostics rollback action.
19. **§19 release gates** — installer-smoke CI evidence on branch; preview publish **owner NO-GO** until sign-off.
20. **Living audit docs** — matrix + backlog + §23 checkpoints tied to commit SHAs and test counts.

## Explicit non-deliverables (do not imply in release notes)

- Custom compiled Mimic/Stealthfox antidetect browser (**BLOCKED**).
- Canvas/audio/WebGL vendor spoofing on stock engines (**UNSUPPORTED**).
- Human typing emulation (M33) (**MISSING** / out of scope unless re-scoped).
- Google CAPTCHA-free guarantee (**UNSUPPORTED**).
- Cloud profile sync, billing, Multilogin proxy pools (**NOT_APPLICABLE_CLOUD**).
- Android cloud phone farms (**PARTIAL** ADB list only; not farm-equivalent).
