# §23 Final engineering report (checkpoint — tab restore UX + CookieRobot CDP + Firefox prefs)

**Branch:** `feature/dedicated-browser-engine`  
**Prior tip:** `743d94b` (CookieRobot polish) · docs `f924e5b`

## 1. Commit
**Tip:** _(this package)_ — native tab restore discoverability, Firefox proxy/locale prefs, CookieRobot CDP integration test.

## 2. Package
- **Tab restore UX:** `tabRestore` on public profile API (enabled + saved count); Profiles list badge; General → Startup nudge in profile editor; Startup tab notice; opt-in launch plan tests (`test/native-tab-restore-launch.test.js`).
- **Harvest path:** unchanged logic (`resolveNativeTabUrlsForSave` on stop/health); launch plan reads `.pm-tabs.json` when `restoreTabs` is true.
- **CookieRobot:** `runCookieRobotTasksOverCdp` extracted; job runner simplified; **real** headless Chromium CDP test (`test/cookie-robot-cdp.test.js`).
- **Firefox P1:** HTTP/HTTPS vs SOCKS5 `user.js` proxy prefs; `intl.accept_languages` / `intl.locale.requested` (`test/firefox-proxy-locale.test.js`).

## 3. Tests
`npm run test:browser-runtime` — **77 pass / 0 fail** (was 71).

## 4. §19
Still **NO-GO publish** without owner sign-off. No `[ci:installer-smoke]` (no packaged launch/proxy edits).

**No Multilogin equivalence percentage claimed.**
