# M3 implementation and current acceptance state

Branch: `feature/m3-locale-timezone-language`.
Starting M3 commit: `3b9414e332a9ace1874135085bec1ea2c6374924`.
Frozen M1 parent: `d7a000eeadd4f4645a608a1e0cc2b8ad154a75d9`.
Status: **WIP — real headless Chromium verification passes; full acceptance pending**.

## Completed scope

Per-profile locale, validated IANA timezone and ordered BCP 47 preferred languages
persist through create, edit, settings-only clone, reset and server restart.
Migration 8 preserves existing M1 rows and host defaults. UI validation and
next-launch notices remain in the profile editor. Authentication, migration
backup, proxy secrets, default automation-off and all M1 classifiers are retained.

Real Chromium exposed an actual implementation defect: native language flags
changed navigator languages and headers while Intl stayed en-US. Playwright's
locale option instead reduced preferred languages to one entry.

The fix keeps native --accept-lang and configures ICU through
Emulation.setLocaleOverride before new page scripts run. Commands use the existing
Playwright pipe, with no new TCP port and no JavaScript getter replacements.
The native session adapter uses the exact pinned playwright-core 1.64.1 bridge,
as the existing lifecycle process adapter does. Missing capability fails explicitly.
Shared-renderer override conflicts are accepted only after observing the native
locale. In-process teardown events reclaim the override for surviving popups
before the client observes opener closure; a repeated first-observation regression
covers that race. Setup failure closes the context and reports an error.

## Actual evidence — Node 22.23.4, Linux x64

| Command | Passed | Failed | Skipped |
|---|---:|---:|---:|
| npm run test:m3 | 33 | 0 | 0 |
| npm run test:m3:browser | 2 | 0 | 0 |
| npm run test:unit | 94 | 1 | 0 |
| node --test test/termination-evidence.test.js test/desktop-unit.test.js | 19 | 2 | 0 |
| npm run test:api | 41 | 0 | not reported |
| npm run test:proxies | 62 | 0 | not reported |
| npm run test:security — security | 37 | 0 | not reported |
| npm run test:security — migration | 4 | 0 | not reported |
| node scripts/run-with-automation.mjs test/engine.e2e.js | 38 | 4 | not reported |
| npm run test:ui | 24 | 1 | not reported |
| Frozen-baseline focused process assertions | 0 | 3 | 0 |

UI builds, syntax and whitespace checks pass. The two real-browser tests are
broad integration tests with multiple assertions, not two individual field checks.
They execute genuine pinned Chromium with no mock/skip fallback. Unit protocol
stubs are explicitly identified and do not count as browser evidence.

Real observations cover locale-only, languages-only and combined settings; IANA
timezone; navigator.language/languages; Intl; ordered HTTP Accept-Language; first
scripts in new pages/popups; opener closure; repeated page lifetimes; simultaneous
independent browsers; clone; unchanged running browser after save; next-launch
application; real server restart; native reset to a default control browser;
a migrated M1 profile retaining native defaults; UI create/edit and reload.
Native protocol tests confirm pipe transport without a CDP TCP port. API tests
continue checking default automation-off.

## Runtime recovery

CDN: HTTP 200, Content-Type text/html, 195 bytes, "Site Unavailable".
Response SHA-256: 5b131ca14aa96311d3432b0062c7443d3b0e6346ec279bd376a75f0a76bcd5d7.
Requests traverse this host's managed loopback proxy. The observed response is
path-specific; this does not establish whether the proxy or upstream generated it.

Google's official Chrome for Testing bucket supplied the exact pinned version
156.0.8078.4 / revision 1248. Both full archives matched the unchanged manifest:

- Chromium: 200345244 bytes;
  43fd31766c7533a02dda2ded5ad50c2f861cd5400be7509c0abad71129f79d79
- Headless shell: 125797539 bytes;
  c3e50596aef52c58f8fda3c6b3411c33d34c88b177b3ed1c2243359fd3b8ba20

One full download per archive was used. No browser revision, dependency lockfile,
manifest pin or verification policy changed. The scoped runtime helper validates
archives through the existing size/SHA checks before installation, records the
actual source, and supports verified local archives without another download.

## Remaining gates and precise causes

1. **PID namespace/procfs mismatch.** A live Node process reported PID 5, while
   /proc/5/cmdline named /bin/bash; its child reported PID 13 and /proc/13/cmdline
   returned ENOENT. The same three process assertions fail in an isolated frozen
   baseline source copy, using the same Node 22/browser. No process guard or
   failing assertion was changed. The unit failure now reaches browser ownership;
   it is no longer a missing-Chromium failure.
2. **Process-dependent regressions are not green.** Engine failures concern crash
   status/event classification, orphan liveness and verified orphan cleanup.
   UI failure is the existing lifecycle event/status check (20-second timeout).
   Logs record unverified-owner and CLASSIFIER-UNKNOWN on this host. This is
   consistent with the reproduced procfs mismatch, not a proven new M3 regression;
   supported-host confirmation is still required.
3. **Full desktop Chromium is blocked.** It aborts in process_singleton_posix.cc
   at socket() with EPERM (Operation not permitted); /proc task inspection is
   also unavailable. No Xvfb/display is installed. The headed M1 lifecycle suite
   was not run, and no forbidden socket/process workaround was introduced.
4. **Windows qualification is pending.** No Windows CI, installer or manual QA
   was dispatched here. The private native-session adapter and supported full
   Chromium/desktop path must pass the required Windows/Linux regression gates.

Draft PR #3 stays draft, based on integration/m1-to-main. PR #2 is unchanged and
unmerged by this work. M2 backend/UI/QA pins remain frozen, M2's artifact exception
and 35 QA todos remain open, and no M2 code is silently integrated into M3.
Eventual integration must preserve both M1 integration history and separately
approved M2 work; a clean source test here is not authority to merge or sign off.

See runtime-verification.md for reproduction, and runtime-evidence.json for
machine-readable summaries and local log hashes. The JSON is a source-test
summary, not an uploaded CI artifact bundle.
