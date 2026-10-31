# Ultimate 2.0 advanced privacy — separate scorecards

**Original source:** `feature/ultimate2-advanced-privacy` — reconciled into unified Codex-secure PR  
**Base:** `feature/ultimate2-feasible-completion` @ `8251394d27bda34fc4625a276e109752a419bec5`  
**Implementation checkpoint:** `bd84f19` (prior: `363b572`, `1a42352`)  
**No pull request, no merge, no installer, no Windows workflow dispatch.**

Historical matrix rows are not edited by this branch. M20–M23 and M28–M30 stay **PARTIAL**. M24–M27 and M42 stay **UNSUPPORTED**. Stock-feasible PASS rows are not added to the frozen baseline.

## A — Historical matrix (denominator 43, unchanged)

| | |
|--|--|
| Formula | `(VERIFIED + 0.5 × PARTIAL) / 43` |
| VERIFIED | 18 |
| PARTIAL | 20 (including M20–M23 and M28–M30; see strict matrix) |
| UNSUPPORTED | 5 (M24, M25, M26, M27, M42) |
| Cloud excluded | 2 (M16, M39) |
| Coverage | **≈ 65.1%** (`28 / 43`) on unified strict matrix; Grok source snapshot separately 80.2% |

Source: `MULTILOGIN_COMPLETE_TECHNOLOGY_MATRIX.md`. `server/privacy-acceptance.js` re-reads that file.

## B — Stock-feasible baseline (frozen, not recomputed)

| Record | Value |
|--------|--------|
| Owner baseline for this branch | **23/23 PASS**, **7 BLOCKED_CUSTOM_ENGINE** excluded |
| Published named PASS rows in `FEASIBLE_LOCAL_ACCEPTANCE_M20_M30.md` | **23** |
| Recalculated on this branch | **No** |

Deepening below is evidence on top of that baseline. It does not create a new stock-feasible percentage.

## C — Custom-engine experimental acceptance

| ID | Matrix | Qualification | What was tried |
|----|--------|---------------|----------------|
| M24 Canvas | UNSUPPORTED | **BLOCKED** | Opt-in page hook (`experimental.canvasReadback = prototype`). Real Chromium shows a changed readback, a stable hash across restart, and `window.__pmCanvasPrototype.customEngine === false`. Not an engine patch. Misses workers, OffscreenCanvas, WebGL readPixels, and native launch. |
| M25 AudioContext | UNSUPPORTED | **BLOCKED** | No stock noise API. No prototype. A page hook would not qualify. |
| M26 WebGL mask | UNSUPPORTED | **BLOCKED** (matrix) / **EXPERIMENTAL_NOT_ENGINE** (prototype) | Stock `--disable-webgl` is restriction only. Opt-in `experimental.webglReadback = prototype` hooks `readPixels` in-page; deterministic offset, stable across restart, `customEngine === false`. Not vendor/renderer masking. |
| M27 WebGPU mask | UNSUPPORTED | **BLOCKED** | No supported identity switch. Prior Linux check did not remove `navigator.gpu`. |

A full Chromium rebuild was not started. Research notes and page hooks are not a completed custom engine.

## D — Windows / browser qualification

| Host | Result |
|------|--------|
| Linux, pinned CfT, when installed | Real Playwright CDP observables in `test/advanced-privacy-browser.test.js` |
| Windows | **NOT_RUN**. No workflow was dispatched. Not a PASS. |

## Phase A — original requirements still open

| ID | Satisfied on stock | Still needs an engine change |
|----|--------------------|------------------------------|
| M20 | Per-profile locale, timezone, and languages; Chromium `--lang` / `--accept-lang` / timezone; Firefox `intl.*` prefs and Unix `TZ` | Mimic-class agreement across every API. `privacy.timezone.override` is not a stock Firefox timezone control. |
| M21 | Ask / deny / allow, explicit coordinates, restart on the Playwright path, negative deny | Does not conceal GPS or network location outside the browser. **Native spawn:** coordinate override is **BLOCKED_SPAWN** (no stock argv); CDP `Emulation.setGeolocationOverride` on automation path only. |
| M22 | Window, viewport, device scale, restart; off-screen positions clamp to the primary origin when displays are known | No multi-monitor identity mask. Firefox has width and height only. |
| M23 | Presets tied to the installed Chromium; reduced vs full; inconsistent versions are warnings | Cannot invent a version. Firefox has no client hints from these presets. |
| M28 | Restricted adds `--disable-features=FontAccess`, writes `local_fonts: 2` in preferences, and denies `local-fonts` via CDP when the API is enabled. With FontAccess off, `queryLocalFonts` is missing and `permissions.query({ name: 'local-fonts' })` may throw instead of returning `denied`. `measureText` still returns a width. | Substitute font list, and a block of canvas font measurement. |
| M29 | Camera and microphone deny in preferences and CDP. `getUserMedia` does not return a stream. `classifyMediaCaptureError()` separates **NotAllowedError** (policy) from **NotFoundError** (no hardware). Headless Linux often yields NotFoundError. | No fake device names or counts. |
| M30 | Launch refuses private-network weakening flags; live argv has none. Default `portScan: real` writes **`local_network_access: 2`** so `local-network-access` permission queries deny without argv weakening. | No masked port-scan result. Clean argv is not proof that every probe fails. |

## Phase C — M42

The CAPTCHA-free guarantee stays **UNSUPPORTED**. Diagnostics and CookieRobot URL refusal are unchanged. Nothing in this branch reports a solved challenge.

## Evidence (Linux CfT)

Linux host, pinned Chromium for Testing **156.0.8078.4** (revision 1248), Playwright CDP. Not mocked.

| Check | Result |
|-------|--------|
| `test/advanced-privacy-acceptance.test.js` | PASS (13) — matrix freeze, M21 BLOCKED_SPAWN, FontAccess launch args, M29 error classification, M24/M26 prototypes, prefs/`local_network_access` |
| `test/advanced-privacy-browser.test.js` | PASS — locale/timezone/geo, screen scale, FontAccess argv, prefs keys, PNA clean argv, restart, canvas + WebGL readPixels prototypes |
| `test/fingerprint-feasible-local-acceptance.test.js` | PASS |
| `test/fingerprint-privacy-launch.test.js` | PASS |
| `test/fingerprint-settings.test.js` | PASS |
| Windows qualification | **NOT_RUN** |

- API: `GET /api/privacy-acceptance` (`geolocationNative`, `C.rows[].prototypeQualification` for M26)

_Update the implementation checkpoint line at the top when the branch tip changes._

## Unified PR integration note

Historical score on the secure unified branch is conservatively 18 VERIFIED / 20 PARTIAL / 5 UNSUPPORTED / 2 cloud-excluded (65.1%). The original Grok source score of 80.2% was not adopted without Windows qualification. Stock-feasible 23/23 PASS with seven excluded custom-engine criteria. Both Canvas and WebGL readback prototypes are explicit opt-in page hooks (not custom engines) and M24/M26 remain UNSUPPORTED; M42 is also UNSUPPORTED. M8 Linux real Chromium/Firefox tests reported PASS on QA lineage, but Windows validation is pending.
