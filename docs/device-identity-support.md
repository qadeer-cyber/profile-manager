# Device Identity support matrix (Phase 2)

Code: `server/device-identity.js`. API: `GET /api/device-identity`. Editor: Fingerprint tab → **Device identity**. Verification: the `device_identity` finding, which is the "Device identity" row in Verify Profile Settings.

## Principle

A stock Chrome Stable, Chromium or Firefox profile presents the **computer it runs on**: its OS, `navigator.platform`, UA-CH platform and `platformVersion`, fonts, GPU, audio stack, media devices and input devices. AZWAH does not rewrite those values. A device preset is therefore a declared identity that AZWAH **verifies** against the live browser.

- A preset the host cannot present is listed, disabled, explained and refused by the server (HTTP 400). It is never stored.
- A profile restored onto a different computer keeps its saved preset, is still editable, and verifies as `warning` until the preset is changed.
- `pass` requires a live observation. A stopped profile verifies as `unavailable`.

## Preset support by host

Legend: ✅ supported (selectable, verified at runtime) · ⛔ refused (disabled, with the reason shown).

| Preset | Windows 11 host | Windows 10 host | macOS host | Linux host | Why |
|---|---|---|---|---|---|
| Match this computer | ✅ | ✅ | ✅ | ✅ | The real identity |
| Windows 11 desktop | ✅ | ⛔ | ⛔ | ⛔ | Chrome reports the real `platformVersion` (≥13 on Windows 11) through client hints |
| Windows 10 desktop | ⛔ | ✅ | ⛔ | ⛔ | Same; build 22000 or later is Windows 11 |
| macOS iMac | ⛔ | ⛔ | ✅ | ⛔ | Needs macOS fonts, `MacIntel`, Apple GPU strings. The iMac/MacBook distinction is not observable and is not claimed |
| macOS MacBook | ⛔ | ⛔ | ✅ | ⛔ | As above |
| Linux desktop | ⛔ | ⛔ | ⛔ | ✅ | Needs the `Linux x86_64` platform, Linux fonts and GPU stack |
| Android phone | ⛔ | ⛔ | ⛔ | ⛔ | Needs a real Android device and a mobile engine. Desktop Chrome with a phone-sized window and a borrowed UA is still desktop Chrome |
| Android tablet | ⛔ | ⛔ | ⛔ | ⛔ | As above |
| iPhone | ⛔ | ⛔ | ⛔ | ⛔ | iOS browsers are Apple WebKit. Chrome, Chromium and Firefox cannot present WebKit |
| iPad | ⛔ | ⛔ | ⛔ | ⛔ | As above |

The same table applies to every engine AZWAH runs (Chrome Stable, bundled or native Chromium, the experimental privacy engine and Firefox), because each exposes the host's platform.

## What is checked for a supported preset

| Signal | How | Status |
|---|---|---|
| `navigator.platform` | Must match the preset OS (`Win32`, `MacIntel`, `Linux…`) | Live, `device_identity` |
| UA-CH `platform` | Must be `Windows`, `macOS` or `Linux` for the preset | Live, `device_identity` |
| UA-CH `platformVersion` | Windows 11 needs major ≥13; Windows 10 needs 1–12 | Live, `device_identity` (newly collected) |
| UA-CH `mobile` | Must be `false` | Live, `device_identity` and `ua_hint_pin` |
| User agent and client-hint version | Existing `ua_version`, `ua_client_hints` and `ua_engine_coherence` checks | Live |
| Screen, viewport and DPR | Existing window settings; observed in the `screen` category | Live |
| Touch (`maxTouchPoints`) | Newly observed and reported; touch is never added | Observation only |
| hardwareConcurrency and deviceMemory | Always the host's (`navigator_custom` informational note) | Real-only |
| Fonts, WebGL/WebGPU, canvas and audio | Real values; see their own categories | Real-only, with restrict options where supported |
| Media devices | Real devices, or Restricted (deny) | Existing category |
| Locale, languages, timezone and geolocation | Existing categories (proxy-following where `conditional`) | Live |
| Persistence after restart | `test/device-identity-api.test.js` restarts the API server | Tested |
| Second simultaneous profile | Presets are per profile; values come from the same host, so two profiles agree by construction. The live multi-profile consistency check is `chrome-stable-windows-live` | Windows gate |

## Tests

- `test/device-identity.test.js`: host detection from Windows build numbers, the support matrix for four hosts, validation, and verification statuses (`pass`, `warning`, `unavailable`, and a profile moved to another OS).
- `test/device-identity-api.test.js`: every refused preset returns 400 and is not stored; a supported preset survives an unrelated save, an API restart and a clone; a stopped profile is `unavailable`.
- `test/fingerprint-catalog-contract.test.js`: the 17th category is wired to the `device_identity` finding.
- `web/e2e/ui-smoke.mjs` (Fingerprint tab step): every unavailable preset is a disabled option, a supported explicit preset saves through the editor, and verification shows 17 category rows with no pass while stopped.

## Not offered, and why

- **Mobile emulation:** Chrome device emulation changes the window, UA and touch flags, but the GPU, fonts, platform and engine stay desktop. The spec forbids presenting that as a mobile device.
- **Win10/Win11 switching on the same host:** high-entropy client hints would contradict it unless they were overridden too. That is the kind of spoofing Decision 3 excludes.
