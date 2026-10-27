# M3 locale, timezone and preferred languages

Branch: `feature/m3-locale-timezone-language`.
Parent: frozen M1 `d7a000eeadd4f4645a608a1e0cc2b8ad154a75d9`.
Status: **WIP / PARTIAL / NOT ACCEPTED**. No M2 code is merged into this branch.

Owner authorized implementation on 2026-10-27. Scope follows the existing master
directive B2/B3: explicit per-profile settings, host defaults, persistence,
validation, browser observation and next-launch application. No location lookup,
IP changes, new automation permissions, installers, merges or releases.

## Implemented and tested without a browser

- Profile create/read/update/list/clone carry `browserSettings`:
  `{ locale: '', timezoneId: '', languages: [] }` by default.
- Empty settings retain host/browser defaults. Partial updates preserve omitted
  fields; explicit empty strings/array reset settings. Null is rejected.
- BCP 47 tags are canonicalized, ordered language lists reject duplicates and
  more than 10 entries, and IANA timezone IDs are validated/canonicalized with
  Intl. An explicit locale must match the first explicit preferred language.
- Invalid settings return HTTP 400 with `INVALID_BROWSER_SETTINGS` before
  profile/proxy writes. Existing authentication is retained.
- Additive migration 8 stores regional JSON. Migration backup, M1 row retention,
  idempotence and a genuine server stop/restart are tested.
- Profile editor has a Region & language tab, validation and next-launch notice.
  Existing settings are loaded and sent through the profile API.
- Saving a running profile reports `appliesOnNextLaunch`; it does not mutate the
  running browser. Runtime verification of that behavior remains pending.
- Launch options carry timezone and locale; ordered preferred languages use
  native Chromium `--accept-lang` and `--lang`, avoiding Playwright's locale
  option in that case because it sets a single-language CDP override.
  **This ordered-language path is NOT browser-verified**, including Intl locale
  behavior on Linux, and must pass the real-browser suite before acceptance.
- Automation remains off by default; no new listener or lifecycle classifier
  change. Stub launch tests check options and failed-launch lock release only.

## Actual validation on this host

Runtime: Linux, Node 24.22.1. Locked dependencies installed using npm ci
`--ignore-scripts`; better-sqlite3 rebuilt with separately extracted official
Node headers. No package or lockfile dependency versions changed. Repository
supported CI uses Node 22; this host is not Windows qualification.

| Command | Actual result |
|---|---|
| `npm run test:m3` | 29 passed, 0 failed, 0 skipped, 0 todo |
| `npm run build` | pass |
| `npm run test:unit` | 94 passed, 1 failed, 0 skipped, 0 todo |
| `node --test test/termination-evidence.test.js test/desktop-unit.test.js` | 19 passed, 2 failed, 0 skipped, 0 todo |
| `node --test test/browser-settings-browser.test.js` | 0 passed, 1 failed, 0 skipped, 0 todo |
| `git diff --check` | pass |

The named `npm run test:m3` command was also executed successfully.
Migration regression expectation changes `[6,7]` to `[6,7,8]`; no checks or
lifecycle assertions were removed. Migrations 1–7 remain unchanged.

## Genuine blockers

1. Pinned Chromium 1248 download returns a small HTML response instead of a ZIP;
   Playwright reports an invalid/truncated ZIP. No Chromium executable exists.
   The existing unit test that observes the launched browser child fails because
   the headless shell is missing. The real M3 acceptance suite fails with
   `CHROMIUM_MISSING`; it does not skip or replace browser checks with mocks.
2. This host cannot read its spawned child via `/proc/<child pid>/cmdline`
   (direct diagnostic: ENOENT). Two unchanged desktop process-inspection tests
   fail. Process inspection implementation and those tests are unchanged.

An initial unit run also encountered the QA-branch workflow snapshot. Local
validation was corrected to use the exact M1 workflow that exists on this
branch; the final result above includes only the missing-Chromium failure.
No workflow edit is included in the M3 commit.

## Exact next step

On a supported host with the locked Chromium installed, run `npm run test:m3`,
`npm run test:m3:browser`, then the existing unit/lifecycle/proxy/security/UI suites.
The browser suite checks native Intl/navigator/header observations, two isolated
profiles, next-launch application, restart and UI save persistence. It must run
before claiming runtime correctness; native language/Intl consistency may need
adjustment if observation disagrees. Complete Windows source tests and required
manual gates separately. No CI was dispatched here.

M2 evidence and the quota exception are recorded independently in
`../m2/run-52-attempt-2.md` and its JSON companion. Original M1 and all M2 branch
heads remain frozen. This commit is not milestone acceptance.
