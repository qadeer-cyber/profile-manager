# Managed Firefox lifecycle checkpoint — 2026-11-05

Runtime source 989dd0428ed6d822c2ea4a7c8aa80f4eaf4b21bb passed Windows Server 2022 run 42037368611. The evidence file records all log hashes and the artifact digest. The score/evidence follow-up changes acceptance metadata only.

## Selecting the supported mode

In the profile editor's Region & language tab, select Firefox session mode → Managed BiDi timezone. The persisted browserSettings.firefoxSessionMode value is bidi. Configure the usual timezoneId, locale and language list. This works with automation enabled or disabled. The managed connection is internal to the application in both cases. Existing profiles retain legacy Marionette behavior until explicitly changed. Independent geckodriver is supported in legacy mode and returns a conflict in managed mode. The two modes do not claim simultaneous independent remote sessions.

Authenticated automation uses POST /api/v1/profiles/:id/firefox/command with a method and params object. The allowlist covers content script evaluation, input actions, navigation, tabs and user contexts. Direct session creation/termination, timezone reconfiguration, extension mutation and browser close are excluded. Application-owned extension endpoints and Stop provide the confirmed privileged operations. Every borrow validates the current process against the profile and holds the per-profile operation lease until it completes or times out. HTTP clients can reconnect using a fresh request without creating another Firefox remote session.

## Ownership audit

| Operation | Legacy mode | Managed mode |
|---|---|---|
| Native launch | Temporary Marionette NewSession verifies canonical profile and browser PID, then DeleteSession | One BiDi session.new verifies the same profile/PID capabilities and OS ownership |
| Initial navigation | Native URL arguments | Apply timezone and locale to default user context before configured URLs are navigated |
| New user contexts | External WebDriver owns its context | Owner applies configured timezone/locale before returning the context ID |
| Permanent extension install/remove | One bounded temporary Marionette session with existing contention guard | Borrow owner connection for webExtension.install with archivePath and moz:permanent=true, or webExtension.uninstall |
| Extension security verification | Existing XPI archive/hash checks, strict Mozilla signing preferences, persisted package/state readback | Same checks and readback, with Firefox's signed permanent-install policy enforced |
| Geckodriver | Bridge holds the existing profile session lease until process exit | Independent startup rejected with busy/conflict |
| Authorized managed automation | Separate legacy WebDriver workflow | Borrow owner through authenticated, recovery/workspace-guarded application API |
| Application Stop | Verified Marionette Quit or owned native-window close, then existing wait/kill safety | Borrow browser.close first, retain existing native fallback and PID/lock checks |
| PID/connection loss | Existing stop/recovery handling | Mark disconnected, report timezone=null and requestedTimezone separately, reject new commands, preserve browser/profile records until explicit Stop succeeds |
| Final cleanup | Existing process and profile-lock cleanup | Close owner connection only for the matching browser PID, after confirmed termination |

Failed borrowers never delete the lifecycle owner or release the filesystem profile lock. Privileged operations contend through the shared lease. Stop rejects an active managed operation instead of interrupting a signed installation. Transport requests have bounded pending commands, response size and deadlines. Unsupported privileged Firefox pages remain inaccessible through content automation.

## Actual Windows acceptance

Four managed cases passed with no skips. Headless automation and real headed/manual windows each tested Berlin, Tokyo and UTC, concurrent profiles, January/July offsets, Berlin's March DST boundary, Date and Intl, localized formatting, same/cross-origin iframes, dedicated/shared workers, new user contexts and tabs, application restart and timezone reapplication. Signed-extension acceptance tested permanent installation, tampered signature rejection, busy automation without timezone loss, restart persistence, encrypted fresh-install restore and removal. The fourth case timed out an actual remote command and verified disconnected diagnostics, released borrower state, explicit Stop/relaunch and preserved localStorage.

Both legacy signed UI acceptance executions passed on the final source. Full Chromium/Firefox runtime, recovery, stabilization, API, security, UI and Track C suites passed. Existing privilege/credential skips are recorded separately. Strict M20 gates all pass, raising the original matrix from 68.6% to 69.8% without changing its denominator.

Earlier run 42034502522 reported one legacy add-on removal persistence failure after its targeted legacy lifecycle had passed. The persisted-state assertion was retained. The next source added diagnostic flags/package-presence reporting, and both targeted and broad repetitions passed. That earlier failure is retained as a reliability observation rather than attributed to a proven timing cause.

## Remaining boundaries

Managed and independent geckodriver sessions remain mutually exclusive. The supported workflow uses the persisted mode selector and authenticated managed API. Automated UI coverage of selecting the new mode is still narrower than the API/browser acceptance. Windows Server 2022 source acceptance does not qualify an installed Windows 10 application, physical multi-monitor/DPI hardware, an NSIS installer or an upgrade. M8/M12/M14/M38 remain PARTIAL. M42 remains UNSUPPORTED. No custom Firefox engine was required or built.

Source qualification supports preparing a separate experimental build. Publishing or qualifying an installer remains NO-GO until native Electron rebuilding, bundled-runtime verification, clean installation and upgrade gates pass.

Mozilla reference: https://firefox-source-docs.mozilla.org/remote/webdriver-bidi/Extensions.html documents moz:permanent=true and mandatory signing. The earlier timezone investigation remains historical evidence of the independent-session conflict, which this owner removes.
