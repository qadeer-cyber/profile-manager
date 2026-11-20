# AZWAH own browser engine: daily work log

Owner request (2026-11-20): one hour a day, in separate parts, combined into one engine. Each daily session takes the first unfinished part, records measured evidence here, and links the commit or run. A part is done only when its check is met on Windows, not when code merely exists.

Chrome Stable stays the shipping engine until the owner approves a switch. Masking parts start only after parts 1–3 pass.

## Parts

| # | Part | Done when | Status |
| --- | --- | --- | --- |
| 1 | Chained build makes real progress | Stage 2 reuses stage 1's work (sccache hits) and Ninja gets further | In progress: run 44706934362 failed (no cacheable compiles); fix in the next run |
| 2 | Finished browser | `chrome.exe` + runtime files built, manifest with source/patch SHA-256, launches, navigates and exits cleanly on a Windows runner, archive hash read back | Not started |
| 3 | Browser package in AZWAH | Experimental runtime option uses the built browser from the installer; own data folder; Chrome Stable profiles untouched | Not started |
| 4 | Real-profile qualification | Two profiles isolated, authenticated HTTP/SOCKS5 proxy, proxy timezone without automation, 30 stop/restart cycles, no Crashed marker | Not started |
| 5 | Canvas privacy (opt-in) | Readbacks differ across sites and sessions, stable within a site; charts and images render correctly; kill switch | Not started (design: `docs/privacy-threat-model.md`) |
| 6 | Audio | Separate design review, then same checks | Not started |
| 7 | WebGL readback | Separate design review, then same checks | Not started |
| 8 | Fonts | Separate design review, then same checks | Not started |
| 9 | Combine | All passed parts enabled together in one build; full Windows qualification; owner decides on promotion | Not started |

## Log

- **2026-11-20:** Chain workflow (`6cd3bb3`) started; patch applies to pinned Chromium 159.0.8153.0; stage 1 compiling. Per-stage build-input diagnostics added for future runs (`e2591b7`, `694844e`). Threat model and Brave license audit written (`a617fa7`).
- **2026-11-20, run 44706934362 stage 1 (measured):** sync 16.5 min; compile 4 h 36 min, Ninja 28,027 / 58,933 steps; sccache 23,303 compile requests, **0 cached** — all non-cacheable (`-fmodules-cache-path` 23,302, `-x` 1); cache size 0; the budget stop was reported as a failure (taskkill exit code), so the hand-over and stages 2–6 were skipped. Root causes: Chromium's `use_clang_modules` (default on Windows at the pinned revision, `build/config/c++/c++.gni`) adds `-fmodules-cache-path`, which sccache does not cache; the step's exit code after `return`. Fixes: `use_clang_modules = false` with sccache; an early cacheability check that compiles `//base` and stops within minutes if fewer than 90% of compiles can be cached; exit code reset after a budget stop. Stage 1's compile commands, toolchain versions and environment were not recorded by that workflow and are not recoverable.
- **2026-11-20, run 44749921438 stage 1 (measured):** `use_clang_modules = false` accepted. Cache check on `//base`: 1,999 compiles, 1,780 stored, 219 hits, 0 non-cacheable. Whole stage: 14,791 compiles, 14,508 stored, 279 hits, 0 non-cacheable; cache 349,326,990 bytes; Ninja 15,681 / 56,561 at the budget (slower than 28,027 / 58,933 with modules on). Budget stop exited cleanly. Recorded inputs: runner image 20261116.315.1, clang 24.0.0git (llvm `c3223914`), sccache 0.19.0, Visual Studio 18.12.0, SDKs 10.0.26100.0 and 10.0.28000.0; sample compile commands use relative sources, absolute paths only for Visual Studio system headers. The new diagnostics step failed (a sample target, `dom.obj`, does not exist; Ninja exit 1), which skipped the cache hand-over, so this stage's cache was lost. Fix: diagnostics cannot fail the job; the hand-over runs whenever the build stopped at its budget.
