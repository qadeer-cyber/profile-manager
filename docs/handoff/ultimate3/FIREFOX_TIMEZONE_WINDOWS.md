# Windows Firefox timezone investigation — 2026-11-05

Current product launches remain blocked for per-profile Windows timezone qualification. M20 is PARTIAL. The timezone probe is experimental and is not called by production launch code.

## Root cause and observations

The product's native Firefox process uses Windows host timezone discovery. In run 42021596854, Europe/Berlin configuration produced UTC and offset 0. The documented TZ mechanism works on Unix but does not provide arbitrary IANA zones through Windows ICU host discovery. Writing privacy.timezone.override has no demonstrated effect. The profile preferences do not intentionally enable privacy.resistFingerprinting to force UTC. These results establish a host-discovery limitation rather than proof of resist-fingerprinting behavior.

Mozilla documents a direct loopback WebDriver BiDi endpoint and emulation.setTimezoneOverride. Firefox 153 expanded its worker coverage. A real Windows probe used that API without patching Date/Intl, changing the host timezone, changing Mozilla signing preferences, or disabling sandbox settings.

| Zone | Intl ID | January offset | July offset | Page, two iframe origins, dedicated worker |
|---|---|---:|---:|---|
| Berlin | Europe/Berlin | -60 | -120 | Matched |
| Tokyo | Asia/Tokyo | -540 | -540 | Matched |
| UTC | UTC | 0 | 0 | Matched |

German localized formatting matched Node's explicit-zone formatter. All three profiles were launched concurrently with separate directories and ports. Later simultaneous readback and restart checks were not completed because connection ownership failed. These checks therefore remain unqualified. Native headed/manual browsing was not tested with this mechanism.

Run 42025892891 is FAILED, 0 PASS / 1 FAIL / 0 SKIP. Each attempted independent Marionette NewSession failed with `Maximum number of active sessions`. BiDi subsequently became unavailable. The application depends on Marionette for verified browser identity, permanent signed extension management and graceful shutdown. Enabling an additional session would regress those guarantees. The existing failing acceptance assertion remains enforced.

## Next supported engineering route

Introduce one lifecycle-owned Firefox remote session per running profile. All application automation, signed extension operations and shutdown must share that owner, with capability/identity checks, serialized mutation requests and explicit busy responses to external clients. Validate whether Firefox exposes permanent signed installation through a supported operation in that same BiDi session. A temporary development extension installation does not meet the existing signing/persistence contract. Qualification must prove session cleanup never clears timezone while the profile remains running. This requires a protocol and management redesign before launch integration.

A browser session-scoped setting must be applied before any configured URL loads and reapplied before navigation after process restart. The owner must cover default and newly created user contexts. Navigation, same/cross-origin frames, dedicated/shared workers and their restart lifetimes require independent readback. Existing manual launches must remain explicitly scoped until tested.

## Dedicated engine route if supported management cannot be unified

Pin a public Mozilla release source revision and toolchain, and add an original validated profile preference for an IANA zone. At profile initialization, feed it into Firefox's existing timezone-emulation machinery for each browsing context, including newly created tabs and workers. Propagate changes through Gecko's parent/content/worker mechanisms and invalidate Date/Intl timezone caches together. Use ICU's timezone database for DST and historical offsets. Profile processes supply independent preferences, with the host zone as the explicit fallback for an absent preference. Invalid zones must produce a launch error before navigation.

Keep Mozilla signature verification, extension certificate roots, sandbox flags, process isolation, proxy behavior and profile locking unchanged. Add upstream-style browser and worker tests for Berlin/Tokyo/UTC, Jan/Jul and transition boundaries, navigation/restart, all iframe origins, private contexts and concurrent profiles. Produce Windows x64 builds from pinned source and dependencies, record build transcripts and hashes, then run the existing signed-XPI and encrypted-restore acceptance against that binary. Source and build scripts must be independently reviewable. No custom Firefox binary was built or qualified in this checkpoint.

## Evidence and score

Evidence and artifact digests are in evidence/firefox-timezone-windows.json. Integrated run 42021596854 validates the frozen M22, M35 and M36 contracts. M20's Windows failure does not invalidate those independent gates. Strict score is 21 VERIFIED / 17 PARTIAL / 5 UNSUPPORTED / 2 NA, 68.6%. The fixed 42-group full qualification checklist remains separate. Experimental installer readiness is NO-GO while unified browser-runtime acceptance fails.

Sources:
- https://bugzilla.mozilla.org/show_bug.cgi?id=342068
- https://developer.mozilla.org/en-US/docs/Web/WebDriver/How_to/Create_BiDi_connection
- https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/153
- https://www.w3.org/TR/2026/WD-webdriver-bidi-20261103/#command-emulation-setTimezoneOverride
