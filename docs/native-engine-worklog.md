# AZWAH own browser engine: daily work log

Owner request (2026-11-20): one hour a day, in separate parts, combined into one engine. Each daily session takes the first unfinished part, records measured evidence here, and links the commit or run. A part is done only when its check is met on Windows, not when code merely exists.

Chrome Stable stays the shipping engine until the owner approves a switch. Masking parts start only after parts 1–3 pass.

## Parts

| # | Part | Done when | Status |
| --- | --- | --- | --- |
| 1 | Chained build makes real progress | Stage 2 reuses stage 1's work (sccache hits) and Ninja gets further | In progress: run 44706934362, stage 1 |
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
