# §23 Final engineering report (checkpoint — Phase A P0/P1 remediation)

**Branch:** `feature/dedicated-browser-engine`  
**Prior tip:** `72803fe` · docs `b3a8d99`

## 1. Commit
**Tip:** `278c5a3` — Phase A: trash await, gecko user.js, CookieRobot races/URL validation, upgrade seed via installed server.

## 2. Phase A (complete in this package)
- **A1:** `softDeleteProfile` / `purgeFromTrash` await `stopFn`; refuse trash/purge when still running; trash busy lock.
- **A2:** Deterministic PM managed block in `firefox-gecko-userjs.js` (proxy→direct `network.proxy.type=0`).
- **A3:** CookieRobot generation tokens + cancel before launch/CDP; stale runner ignore.
- **A4:** `cookie-robot-url.js` protocol/host/path validation + post-navigation check hook.
- **A5:** Branch upgrade smoke seeds via `spawnInstalledServer` (Alpha.3 unpacked server), not workspace fork.
- **A6 (partial):** New regression tests (trash, user.js, URL, cancel); full browser E2E matrix still open.

## 3. Tests
`npm run test:browser-runtime` — **94 pass / 0 fail** (was 85).

## 4. §19
Still **NO-GO publish** without owner sign-off. Installer-smoke last green **40934718409** @ `98dbc0c` — not re-run on this SHA.

**No Multilogin equivalence percentage claimed.**
