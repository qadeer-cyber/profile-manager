# Reproduce M3 runtime verification on a supported host

Use an ordinary Windows x64 or Linux x64 host whose process IDs match /proc
(or Windows process APIs), whose process/socket permissions permit Chromium,
and whose Node version is 22. No application installer is built by these steps.

1. Fetch the current feature/m3-locale-timezone-language head and record its
   complete SHA. Read implementation.md and inspect the source diff.
2. Run node --version and npm ci from the repository. Keep package-lock.json.
3. Install the exact manifest-pinned browser using ONE selected official source:

~~~sh
node scripts/m3-install-runtime.mjs --source=google
~~~

The alternative is --source=playwright. There is no automatic retry, version
fallback or checksum bypass. Both archives must pass pinned size and SHA-256.
The Google URL is constructed only from the unchanged manifest's version/path.
If corporate network policy requires proxy configuration, use the host's approved
Node HTTPS configuration; do not disable TLS or integrity checks.

For an offline transfer, copy authentic archives from the same pinned version,
named chromium.zip and chromium-headless-shell.zip, then run:

~~~sh
node scripts/m3-install-runtime.mjs --source=google --archives=/absolute/archive-directory
~~~

Use the appropriate Windows directory path there on Windows. --source identifies
the genuine original source; never label a third-party or unknown archive as Google.
Supplied archives are always reverified, including when a cached install exists.
This helper does not alter the manifest or authorize installing an unrelated version.

4. Run targeted checks and preserve their actual output and exit codes:

~~~sh
npm run test:m3
npm run test:m3:browser
~~~

Missing browsers and mismatched native observations must fail, not skip.
The runtime tests perform real browser launches, native field and HTTP checks,
UI create/edit, legacy migration/defaults, clone/reset/restart and popup checks.

5. On Windows, run the existing source regression commands:

~~~sh
npm run test:unit
npm run test:desktop
npm run test:api
npm run test:engine
npm run test:proxies
npm run test:security
npm run test:ui
~~~

On Linux, run those same source commands with a working display; if using Xvfb,
wrap the desktop/engine suites (including lifecycle.e2e.js) with xvfb-run -a.
Do not replace the headed lifecycle suite with headless shell: it needs the full
browser's real Preferences exit_type. Do not add skip flags or relax PID ownership.

6. Record exact OS, Node/browser versions, commit SHA, commands and pass/fail/skip/
todo totals, distinguishing mocked unit tests from real browser tests. Preserve
all failed output. Keep draft PR #3 WIP until supported-host regression and
required review/manual gates pass. Do not dispatch CI merely to probe artifact
quota, build installers, merge PR #2/#3, retarget the PR, or release.

## Host-specific failures reproduced here

The frozen baseline focused reproduction used unchanged M1 sources:

~~~sh
node --test --experimental-test-module-mocks --test-name-pattern="processCommandLine \\(linux\\)|pidMatches: true|installed playwright-core" test/desktop-unit.test.js test/unit.test.js
~~~

It failed all three selected assertions (0 pass / 3 fail / 0 skip).
The relevant frozen-baseline blob IDs are:

- server/proc.js: ef3cd592941d2457d2abab81bdf06908dfd2da8b
- server/browsers.js: 0afd58465e5a9183272419d24c6e38f35284d19b
- test/desktop-unit.test.js: 84639ad91e3bdf39b27cb0a575c126dba9641045

A standalone parent/child probe also found that reported live process IDs did
not map to this sandbox's procfs entries. This confirms the process-inspection
failure independently of M3 locale changes. It does not turn the affected
regression results into passes or qualify Windows/full desktop behavior.
