# §23 Final engineering report (checkpoint — Firefox gecko prefs + automation UX)

**Branch:** `feature/dedicated-browser-engine`  
**Prior tip:** `a2c15f0` · docs `c4a5266`

## 1. Commit
**Tip:** _(this package)_ — Firefox WebRTC/timezone gecko prefs, cookie API honesty, pm-cli bridges, profile UX.

## 2. Package
- **Firefox P1 (stock):** `firefox-gecko-prefs.js` maps WebRTC modes → ICE `user.js` lines; timezone via `privacy.timezone.override` + `TZ` env; tests `firefox-gecko-prefs.test.js`.
- **Cookie/extension UX:** Firefox profiles get `501 FIREFOX_COOKIES_UNSUPPORTED` on stopped cookie API; Cookies tab + config warnings; Extensions tab blocked for Firefox; removed Stealthfox wording in Settings.
- **Automation polish:** `pm-cli bridges|config`; webdriver-api engine-specific tests; profile-config validate warnings in editor.
- **Delivery planning:** draft `SECTION23_FINAL_DELIVERY_OUTLINE_DRAFT.md` (20 points; not Multilogin-complete).

## 3. Tests
`npm run test:browser-runtime` — **82 pass / 0 fail** (was 77).

## 4. §19
Still **NO-GO publish** without owner sign-off. No `[ci:installer-smoke]`.

**No Multilogin equivalence percentage claimed.**
