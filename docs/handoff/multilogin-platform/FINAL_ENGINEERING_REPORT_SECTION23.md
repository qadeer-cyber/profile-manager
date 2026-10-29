# §23 Final engineering report (checkpoint — gecko cookies read/export)

**Branch:** `feature/dedicated-browser-engine`  
**Prior tip:** `be2b419` · docs `957d2ef`

## 1. Commit
**Tip:** `72803fe` — Firefox gecko cookie read/export, examples suite, §23 final report draft.

## 2. Package
- **Gecko cookies:** `server/gecko-cookies.js` reads stopped-profile `moz_cookies`; `GET /cookies` + `/cookies/export` for Firefox (`readOnly`); import/clear **501 FIREFOX_COOKIES_READ_ONLY**; CookieManager read-only UX.
- **Examples:** `gecko-cookies-export.mjs`, `profile-config-example.mjs`, `pm-cli-bridges-example.md`; README updated.
- **§23:** `SECTION23_FINAL_ENGINEERING_REPORT_DRAFT.md` — full 20-point honest delivery report (not Multilogin-complete); Actions **40934718409**, preview **NO-GO**.

## 3. Tests
`npm run test:browser-runtime` — **85 pass / 0 fail** (was 82).

## 4. §19
Still **NO-GO publish** without owner sign-off. No `[ci:installer-smoke]`.

**No Multilogin equivalence percentage claimed.**
