# M3 native Windows 10/11 QA

Status: **PREPARATION ONLY. No Windows test pass is claimed.**
Runner: `scripts/m3-windows-qa.ps1`.
Requires **64-bit Windows 10/11, Windows PowerShell 5.1 (or PowerShell 7), Node.js
22 x64 including npm, and Git for Windows**. Use an ordinary interactive desktop;
the lifecycle suite opens real Chromium windows. Administrator rights are not
required. Leave several GB free for the isolated dependencies and browser cache.

The application source starts from M3
`c5be5d414c5c5dc6925fdd9ec2ebff2b483d88a0`. The QA preparation commit adds this
runner/documentation. Test the full **QA commit SHA supplied in the delivery
report**, which includes the runner. Do not use an abbreviated SHA or substitute
`git rev-parse HEAD` for a known expected SHA.

## Get an exact, clean checkout

For a new checkout:

~~~powershell
git clone --branch feature/m3-locale-timezone-language https://github.com/qadeer-cyber/profile-manager.git
cd profile-manager
git fetch origin feature/m3-locale-timezone-language
git switch --detach QA_COMMIT_SHA
~~~

Replace QA_COMMIT_SHA with the full 40-character commit from the delivery report.
Private repository authentication uses your existing Git credentials. The runner
does not request or record them. A detached checkout at that exact SHA is supported.

If you already have a checkout, fetch and select that same SHA yourself. The
runner refuses a SHA mismatch or tracked edits; it never resets/stashes/deletes
your work. Untracked/ignored files are not copied into the QA workspace.

## Start validation

From that checkout's repository root, run this command after replacing the SHA:

~~~powershell
powershell.exe -NoProfile -File .\scripts\m3-windows-qa.ps1 -ExpectedCommit QA_COMMIT_SHA
~~~

Node 22 must already be on PATH; the runner verifies the actual executable's
major version, x64 architecture and win32 platform. It does not install/switch
Node. Git for Windows must include sleep.exe, required by existing unchanged
process fixtures. The runner finds Git's usr/bin and adds it only to its own
process PATH. It invokes npm-cli with the verified Node executable.

The script uses only PowerShell 5.1 language/features and includes #Requires 5.1.
Its parser and component logic were checked with official PowerShell 7.6.9 on
Linux; **native Windows PowerShell 5.1 execution is still pending**. Preparation checks:
zero parser errors, 12 passing runner-component checks (quoting, exit codes,
stdout/stderr, failure continuation, JSON and environment restoration), plus two
intentional SHA/platform rejection checks that both retained evidence ZIPs.
These were Linux harness checks, not Windows application test results.
Your execution policy must permit reviewed local scripts. The command does not
use Bypass, change execution policy, disable TLS, or suppress assertions. If
policy blocks the file, follow your Windows/organization's approved policy.

## What runs

The runner first checks full HEAD and tracked cleanliness, then uses git archive
to create a separate copy of that commit. All npm installs and test writes run
inside that copy, not your checkout. It records Node/npm/OS versions, source SHA,
and the original lockfile/Chromium manifest hashes; it checks those hashes again
before finishing.

Setup runs locked npm ci --include=dev, the existing Node-native SQLite check, the existing
verified runtime helper with --source=google, then one UI build. Automatic
Playwright/Electron binary downloads during npm installation are disabled; only
the pinned Google Chromium installer helper is used. Browser revision, size and
SHA-256 checks remain unchanged. A prerequisite/setup failure blocks testing and
is recorded rather than disguised as test success.

Each following suite runs independently, even if an earlier ordinary test fails:

| Stage | Command after the verified Node executable |
|---|---|
| M3 targeted | npm-cli.js run test:m3 |
| M3 real browser | --test test/browser-settings-browser.test.js test/regional-locale-browser.test.js |
| Unit | npm-cli.js run test:unit |
| Desktop unit/process evidence | --test test/desktop-unit.test.js test/termination-evidence.test.js |
| Desktop engine | test/desktop-engine.e2e.js |
| API | scripts/run-with-automation.mjs test/api.e2e.js |
| Engine | scripts/run-with-automation.mjs test/engine.e2e.js |
| Lifecycle, including headed Chromium | scripts/run-with-automation.mjs test/lifecycle.e2e.js |
| Proxy library | scripts/run-with-automation.mjs test/proxy-library.e2e.js |
| Security | test/security.e2e.js |
| Security migration | test/security-migration.e2e.js |
| UI regression | test/ui-smoke.run.js |

The real M3 suites already assert native locale/timezone, ordered languages,
navigator/Intl/header consistency, first scripts/popups and opener closure,
simultaneous isolation, clone, edit, reset, migrated defaults, next-launch
application and restart persistence. The unchanged lifecycle/desktop suites
exercise browser startup, graceful shutdown and forced termination.

Desktop here means the repository's desktop unit/engine suites. This runner does
not package an app, rebuild SQLite for Electron, run installed-EXE tests, or
generate installers. Those remain separately authorized gates.

## Isolation and failure handling

A unique output directory is created beneath:

`%LOCALAPPDATA%\ProfileManager-QA\M3-YYYYMMDD-HHMMSS-xxxxxxxx\`

Process-local PM settings, browser overrides, temp directories, npm cache, browser
cache and screenshot output are isolated there. Existing personal app profiles,
Chrome/Edge user-data directories and your checkout's dependencies are not used.
Environment overrides are restored in finally. The runner never performs broad
profile cleanup or kills browsers by name. Existing tests may remove their own
synthetic directories under the isolated temp root.

Every command has separate complete stdout/stderr files and a recorded exit code.
They are intentionally separate, not a claimed interleaved transcript. runner.log
records stage timestamps. Existing fixture credentials in test output are
synthetic; no personal environment dump is included.

Each process has a 30-minute outer timeout, in addition to existing suite
watchdogs. A timeout records exit 124 and targets only that runner-created process
tree for cleanup; remaining stages are marked BLOCKED. This prevents later tests
from running amid an unknown hung tree. Ordinary nonzero test exits do not stop
later suites.

| Runner exit | Meaning |
|---|---|
| 0 | All listed source-QA commands exited zero; acceptance still requires review |
| 1 | One or more tests failed; other runnable suites were still executed |
| 2 | SHA/preflight/setup/timeout/evidence failure; unrun suites explicitly BLOCKED |

results.json always sets ReadyForAcceptance to false. Exit zero is not permission
to merge, release, waive M2 gates, or claim manual/installer validation.

## Return the results

The console prints the exact output directory at startup and completion.
Send **evidence.zip** from that directory back in this chat. It contains:

- results.json and results.csv with individual results, exit codes and provenance;
- runner.log and every stdout/stderr/timeout-cleanup log;
- synthetic UI screenshots when produced.

Do not send the workspace, tmp, app-data, user-data, npm cache, source archive or
browser binaries. They are deliberately excluded from the evidence ZIP. Nothing
is uploaded automatically, so GitHub's Actions artifact quota is not involved.
If ZIP creation fails, the complete local files remain; send results.json and
the logs directory instead. Preserve failed results for review.

## Remaining acceptance gates

1. Actual Windows source run on the exact QA commit and review of complete logs.
2. Resolve any genuine native failures without dropping assertions; verify the
   pinned native session adapter and process-ownership checks on Windows.
3. Required Windows 10/11 manual checks/review and any separately approved
   installed-app validation. A run on one Windows version does not qualify both.
4. M2 evidence-upload exception, its 35 QA todos and formal M2 sign-off remain
   independent. Combined milestone integration still requires reviewed evidence.

PR #3 stays draft. This preparation changes no M1/M2 branches, CI workflows,
application source, Chromium pins, assertions, merges or releases.
