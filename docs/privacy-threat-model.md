# Native engine privacy protections: threat model and license audit

Status: **design only**. No privacy patch exists in `native-chromium/windows-source.patch`. Work on the first prototype (canvas) starts only after the native browser passes build gate B and real-profile gate C (see `docs/native-chromium-engine.md`).

## What this protects against

A site, or several sites sharing a tracker, reads stable browser values and combines them into an identifier that links visits across sites and across AZWAH profiles that run on the same PC. Today every AZWAH profile on one PC shows the same real canvas, WebGL, audio, font and hardware values (the stock-engine limits in `docs/azwah-capability-parity.md`).

Goals:

- Values derived from rendering (canvas first) differ between unrelated sites and between profiles, so they stop working as a cross-site or cross-profile link.
- Within one site and one browsing session the values stay stable, so ordinary pages (charts, image editors, CAPTCHAs that redraw) do not break or see a value that changes on every read, which is itself unusual.

Not goals:

- Defeating a particular site's anti-bot or security checks, or forging a device that does not exist. Values come from the real rendering pipeline with a small perturbation; nothing claims a different GPU or OS.
- Hiding automation. `navigator.webdriver` and automation state stay accurate.
- Guaranteeing site acceptance. Sites also use IP reputation, account history and behavior.

## Prior art: Brave "farbling" (read for concepts only)

Source read: `brave/brave-core` at `272e1a6` (2026-11-20).

| File | License | What it does |
| --- | --- | --- |
| `third_party/blink/renderer/core/farbling/brave_session_cache.cc` | MPL-2.0 (file header) | Holds a per-session *farbling token*, combines it with the top-level site to seed a PRNG, and perturbs canvas pixel data at readback (`PerturbPixels`). Opaque/partitioned contexts mix in a hash of the storage-key nonce. Levels: off, balanced, maximum, set per site. |
| `chromium_src/third_party/blink/renderer/core/html/canvas/html_canvas_element.cc` | MPL-2.0 | Hooks canvas readback paths (`toDataURL`, `toBlob`, `getImageData`) to call the perturbation. |
| `components/brave_shields/core/common/farbling_prng.h` | MPL-2.0 | PRNG choice (`randen` engine). |
| Repository `LICENSE` | MPL-2.0 | |

Design points worth keeping:

- Perturb at **readback**, not while drawing, so what the user sees on screen is unchanged.
- Seed = secret per-session token combined with the **top-level site** (eTLD+1): stable within a site for the session, different across sites and sessions.
- A per-site off switch for compatibility.

## License position

MPL-2.0 is a file-level copyleft: if AZWAH ships a binary containing MPL-covered files (copied or modified), it must make the source of those files available under MPL-2.0 and keep their notices. It does not require releasing the rest of AZWAH.

Decision: **implement independently**. AZWAH's patch will be original code written against upstream Chromium's own canvas readback paths, using only the design ideas above (ideas are not covered by copyright). No Brave file or substantial excerpt is copied into the patch. If that ever changes, the copied files keep their MPL headers and a `THIRD_PARTY_NOTICES` entry is added before any build is distributed.

## Proposed canvas policy for the prototype (to be measured, not assumed)

| Choice | Proposal | Why | To verify |
| --- | --- | --- | --- |
| Default | Off; opt-in per profile, labelled Experimental | Compatibility unknown | Kill switch works without relaunching other profiles |
| Seed | `HMAC(profile secret, top-level site)`; profile secret regenerated per browser session | No permanent per-profile correlator; stable within a site for a session | Same site, two tabs: identical; two sites: different; relaunch: different |
| Scope | Readback only (`toDataURL`, `toBlob`, `getImageData`, `OffscreenCanvas` equivalents) | On-screen rendering unchanged | Pixel diff of displayed canvas is zero |
| Strength | Flip low bits of a sparse, seeded subset of pixels | Smallest change that alters common hashes | Hash differs; visual diff below threshold |
| Workers and iframes | Same top-level site gives the same seed | Avoids an inconsistency between contexts | Page, iframe, worker readbacks agree |

## Gates before anything ships

1. Build gate B: the native browser compiles, launches, navigates and exits cleanly on Windows.
2. Real-profile gate C: two native profiles, proxy integrity, stop and restart, data retained.
3. Canvas gate D: browser-observed readbacks follow the table above in page, iframe, worker and after restart; ordinary canvas content (charts, images) renders correctly; performance cost measured. If any check fails, the feature stays disabled.
4. Web Audio, WebGL, fonts and device signals each get their own design review afterwards; none is patched together with canvas.
