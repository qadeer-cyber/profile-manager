# Ultimate 2.0 advanced privacy — separate scorecards

**Branch:** `feature/ultimate2-advanced-privacy`  
**Base:** `feature/ultimate2-feasible-completion` @ `8251394d27bda34fc4625a276e109752a419bec5`  
**Implementation checkpoint:** `1a42352ff84275079cf9699f330f6a86b27aa71f`  
**No pull request, no merge, no installer, no Windows workflow dispatch.**

Historical matrix rows are not edited by this branch. M20–M23 and M28–M30 stay **PARTIAL**. M24–M27 and M42 stay **UNSUPPORTED**. Stock-feasible PASS rows are not added to the frozen baseline.

## A — Historical matrix (denominator 43, unchanged)

| | |
|--|--|
| Formula | `(VERIFIED + 0.5 × PARTIAL) / 43` |
| VERIFIED | 31 |
| PARTIAL | 7 (M20, M21, M22, M23, M28, M29, M30) |
| UNSUPPORTED | 5 (M24, M25, M26, M27, M42) |
| Cloud excluded | 2 (M16, M39) |
| Coverage | **≈ 80.2%** (`34.5 / 43`) |

Source: `MULTILOGIN_COMPLETE_TECHNOLOGY_MATRIX.md`. `server/privacy-acceptance.js` re-reads that file.

## B — Stock-feasible baseline (frozen, not recomputed)

| Record | Value |
|--------|--------|
| Owner baseline for this branch | **23/23 PASS**, **8 BLOCKED_CUSTOM_ENGINE** excluded |
| Published named PASS rows in `FEASIBLE_LOCAL_ACCEPTANCE_M20_M30.md` | **22** |
| Recalculated on this branch | **No** |

Deepening below is evidence on top of that baseline. It does not create a new stock-feasible percentage.

## C — Custom-engine experimental acceptance

| ID | Matrix | Qualification | What was tried |
|----|--------|---------------|----------------|
| M24 Canvas | UNSUPPORTED | **BLOCKED** | Opt-in page hook (`experimental.canvasReadback = prototype`). Real Chromium shows a changed readback, a stable hash across restart, and `window.__pmCanvasPrototype.customEngine === false`. Not an engine patch. Misses workers, OffscreenCanvas, WebGL readPixels, and native launch. |
| M25 AudioContext | UNSUPPORTED | **BLOCKED** | No stock noise API. No prototype. A page hook would not qualify. |
| M26 WebGL mask | UNSUPPORTED | **BLOCKED** | `--disable-webgl` remains a restriction. Disabling is not a vendor/renderer mask. |
| M27 WebGPU mask | UNSUPPORTED | **BLOCKED** | No supported identity switch. Prior Linux check did not remove `navigator.gpu`. |

A full Chromium rebuild was not started. Research notes and the page hook are not a completed custom engine.

## D — Windows / browser qualification

| Host | Result |
|------|--------|
| Linux, pinned CfT, when installed | Real Playwright CDP observables in `test/advanced-privacy-browser.test.js` |
| Windows | **NOT_RUN**. No workflow was dispatched. Not a PASS. |

## Phase A — original requirements still open

| ID | Satisfied on stock | Still needs an engine change |
|----|--------------------|------------------------------|
| M20 | Per-profile locale, timezone, and languages; Chromium `--lang` / `--accept-lang` / timezone; Firefox `intl.*` prefs and Unix `TZ` | Mimic-class agreement across every API. `privacy.timezone.override` is not a stock Firefox timezone control. |
| M21 | Ask / deny / allow, explicit coordinates, restart on the Playwright path, negative deny | Does not conceal GPS or network location outside the browser. Native spawn does not apply the coordinate override. |
| M22 | Window, viewport, device scale, restart; off-screen positions clamp to the primary origin when displays are known | No multi-monitor identity mask. Firefox has width and height only. |
| M23 | Presets tied to the installed Chromium; reduced vs full; inconsistent versions are warnings | Cannot invent a version. Firefox has no client hints from these presets. |
| M28 | `local-fonts` permission query is denied, and `local_fonts` is written in preferences. On this CfT build `queryLocalFonts()` can still resolve, so the permission is not a font-list block. `measureText` still returns a width. | Substitute font list, and a block of canvas font measurement. |
| M29 | Camera and microphone deny in the page and in preferences. `getUserMedia` does not return a stream. This headless host has no capture device, so the error is NotFoundError rather than a granted fake device. | No fake device names or counts. |
| M30 | Launch refuses private-network weakening flags; live argv has none | No masked port-scan result. Clean argv is not proof that every probe fails. |

## Phase C — M42

The CAPTCHA-free guarantee stays **UNSUPPORTED**. Diagnostics and CookieRobot URL refusal are unchanged. Nothing in this branch reports a solved challenge.

## Evidence at `1a42352`

Linux host, pinned Chromium for Testing `156.0.8078.4` (revision 1248), Playwright CDP. Not mocked.

| Check | Result |
|-------|--------|
| `test/advanced-privacy-acceptance.test.js` | PASS (9) |
| `test/advanced-privacy-browser.test.js` | PASS — locale `de-DE`, timezone `Europe/Berlin`, coordinates, 1280×800 at scale 2, permission denies, preference keys, clean private-network argv, restart, canvas hook hash change and restart stability |
| `test/fingerprint-feasible-local-browser.test.js` | PASS |
| `test/fingerprint-observable-api.test.js` | PASS |
| `test/fingerprint-browser.test.js` | PASS |
| `test/fingerprint-feasible-local-negative.test.js` | PASS |
| Windows qualification | **NOT_RUN** |

- API: `GET /api/privacy-acceptance`
