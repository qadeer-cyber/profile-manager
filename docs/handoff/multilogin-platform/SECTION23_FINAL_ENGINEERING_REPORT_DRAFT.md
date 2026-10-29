# §23 Final engineering report (draft for owner sign-off)

**Branch:** `feature/dedicated-browser-engine`  
**Alpha.3 frozen:** tag `v0.5.0-alpha.3-m1-m17` @ `2d65207` — **not retagged**  
**Checkpoint tip:** `72803fe` · docs `b3a8d99`  
**Prior checkpoint:** `be2b419` · docs `957d2ef`

This document is the expanded **20-point local delivery report**. It does **not** claim Multilogin-complete parity, a percentage score, Stealthfox/Mimic equivalence, or CAPTCHA-free Google.

---

## Executive summary

Profile Manager on `feature/dedicated-browser-engine` delivers **stock Chromium (CfT) native manual browsing**, a **separate Firefox gecko runtime**, local automation (CDP, WebDriver/geckodriver bridges, CookieRobot), profile lifecycle features, and honest audit docs. **Preview publish remains NO-GO** until the owner completes §19 sign-off. **Custom compiled antidetect Chromium remains BLOCKED.**

| Gate | Status |
|------|--------|
| `test:browser-runtime` | **85** pass @ gecko cookies package |
| §19 installer-smoke (Actions **40934718409** @ `98dbc0c`) | **Green** on branch (upgrade + electron smoke); **no release published** |
| §19 preview / `gh release create` | **NO-GO** — owner gate |
| PR → `main` | **Not in scope** for this track |

---

## 20 delivery points (local product)

### 1. Native manual Chromium (M43)
- Default launch path without Playwright automation pipe when `automation` is off.
- **Evidence:** `test/browser-runtime-native-launch.test.js`, architecture report.

### 2. Stock Firefox gecko runtime (M3 — PARTIAL, not Stealthfox)
- Independent `-profile` tree under `profiles/<id>/gecko`; proxy/locale/timezone/WebRTC ICE prefs in `user.js`; `TZ` env for timezone; marionette when automation on.
- **Evidence:** `firefox-launch-plan`, `firefox-proxy-locale`, `firefox-gecko-prefs` tests.
- **Not claimed:** antidetect patches, extension parity, host Firefox on all CI runners.

### 3. Profile isolation (M1)
- Per-profile `userDataDir`, locks, crash/exit handling (M1–M17 baseline).

### 4. Profile config engine v2
- Typed settings, `GET /profile-config/schema`, `POST /profile-config/validate`, `GET /profiles/:id/browser-config`, engine warnings.
- **Evidence:** `test/profile-config-engine.test.js`, `profile-config-example.mjs`.

### 5. Proxy library (M15, M17 PARTIAL)
- HTTP/HTTPS/SOCKS5, auth relay, saved proxies; provider adapters partial; no cloud traffic saver.

### 6. WebRTC policy (M19 + M3 mapping)
- Chromium `--force-webrtc-ip-handling-policy`; Firefox ICE prefs mapping; no zero-leak guarantee.

### 7. Fingerprint controls (honest partials)
- Stock switches/prefs only; canvas/audio noise **UNSUPPORTED** (M24–M26).

### 8. Extensions — Chromium only (M13, M14 UNSUPPORTED on Firefox)
- Unpacked library; UI blocks Firefox extension assignments.

### 9. Tab restore — native opt-in (M11 VERIFIED)
- `restoreTabs`, `.pm-tabs.json`, harvest on stop/health, Startup/General UX, launch plan tests.

### 10. Quick profiles, trash, templates, clone (M4–M7)
- APIs + UI; lifecycle tests.

### 11. Workspaces local (M38 PARTIAL)
- Local workspaces/vault; no team cloud sync.

### 12. Cookies (M31)
- **Chromium stopped profile:** read/import/clear via Chromium SQLite (encrypted values best-effort).
- **Firefox stopped profile:** **read + export** via `moz_cookies` (`gecko-cookies.js`); import/clear **501 read-only**.
- **Evidence:** `test/gecko-cookies.test.js`, `test/firefox-cookies-api.test.js`, `gecko-cookies-export.mjs`.

### 13. CookieRobot-local (M32 VERIFIED)
- Chromium CDP jobs + `test/cookie-robot-cdp.test.js`; Firefox rejected at create.

### 14. Automation API (M34)
- `/api/v1` + bearer token; CDP when profile `automationEnabled` / launch with automation.

### 15. WebDriver + geckodriver (M37 PARTIAL)
- Localhost bridges; engine-specific start; opt-in driver cache; **not in offline EXE**.
- **Evidence:** `test/webdriver-api.test.js`, `AUTOMATION_DRIVERS.md`, `pm-cli bridges`.

### 16. CLI and examples (M35 PARTIAL)
- `pm-cli` list/launch/stop/schema/config/bridges; `examples/local-automation/*`.

### 17. Diagnostics and fingerprint consistency (M45)
- Hardware/consistency reports; no CAPTCHA bypass tooling (M42 **UNSUPPORTED**).

### 18. CfT update + rollback (M41 VERIFIED)
- Dual-slot backup; Diagnostics rollback; `test/update-manager.test.js`.

### 19. §19 release gates
- Installer-smoke job green on branch (**40934718409**); loopback bypass fix @ `98dbc0c`.
- **Preview publish: NO-GO** until owner sign-off; no `[ci:installer-smoke]` on doc-only commits.

### 20. Living audit artifacts
- `MULTILOGIN_COMPLETE_TECHNOLOGY_MATRIX.md`, `COMPLETE_LOCAL_FEATURE_BACKLOG.md`, §23 checkpoints with commit SHAs and test counts.

---

## BLOCKED / UNSUPPORTED / owner-gated (must stay visible)

| Item | Status | Notes |
|------|--------|-------|
| Custom compiled Chromium / Mimic | **BLOCKED** | Recipe only; no HW budget |
| Stealthfox-class patches | **UNSUPPORTED** | Stock Firefox only |
| Canvas/audio/WebGL vendor spoof | **UNSUPPORTED** | Stock engines |
| Human typing (M33) | **MISSING** | Out of scope |
| Google CAPTCHA-free (M42) | **UNSUPPORTED** | Environmental |
| Cloud sync, billing, ML proxy pools | **NOT_APPLICABLE_CLOUD** |
| Android cloud farms (M40) | **PARTIAL** | Local ADB list only |
| Drivers inside offline EXE | **MISSING by design** | Opt-in cache |
| macOS/Linux native window focus | **MISSING** | Win32/CDP partial |
| §19 preview publish | **Owner NO-GO** | Despite green installer job |

---

## Suggested owner checklist before preview

1. Re-run §19 installer-smoke on current branch tip if launch/plan changed since `98dbc0c`.
2. Manual smoke: native Chromium + Firefox gecko + automation CDP + one WebDriver session.
3. Confirm no Stealthfox/custom Chromium language in UI/docs.
4. Sign §19 preview publish or keep NO-GO.

---

**No Multilogin equivalence percentage claimed.**
