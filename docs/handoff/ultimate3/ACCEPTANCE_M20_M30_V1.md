# Ultimate 3.0 acceptance contracts — M20–M23, M28–M30

**Contract version:** 1.0.0  
**Source of gate IDs:** `server/ultimate3-acceptance.js` (`ROW_CONTRACTS`)  
**Scope:** stock Chromium (pinned CfT) and stock Firefox where a live process can be observed. No Mimic, Stealthfox, or undetectability claim.

## Two metrics (do not mix)

| Metric | Formula | What it is |
|--------|---------|------------|
| **Feature-completion** | `passed stock checks / (passed + failed stock checks)` | Stock checks only. `BLOCKED_CUSTOM_ENGINE` and `not_run` are outside this denominator. |
| **Release-qualification** | `(VERIFIED + 0.5 × PARTIAL) / 43` | Strict matrix only. Denominator stays 43. |

The separate Grok source scorecard is **80.2%**. It is not release-qualification and it is not added to the strict matrix.

A row becomes **VERIFIED** only when every **release gate** below is `pass` in recorded test output. A remainder does not count as a pass. If a release gate is the custom-engine capability itself (`m23-arbitrary-version`, `m28-substitute-font-list`, `m29-fake-device-labels`, `m21-native-coordinates`), the row stays **PARTIAL**.

## M20 — Timezone, locale, and language

Release gates:

- `m20-config-locale-language` — locale and the first language tag must match; unknown timezones are rejected.
- `m20-chromium-timezone-id` — `Intl` time zone equals the profile.
- `m20-chromium-timezone-offset` — `Date#getTimezoneOffset` equals that zone at observation time.
- `m20-chromium-locale` — `navigator.language` equals the profile locale.
- `m20-chromium-languages` — `navigator.languages` equals the profile list, or adds only the base language of a configured tag.
- `m20-chromium-intl-locale` — `Intl` locale equals the profile locale.
- `m20-chromium-accept-language` — `Accept-Language` lists the profile languages in order. Stock Chromium may insert the base language of a regional tag (`de` after `de-DE`) at a lower q. An unrelated tag fails.
- `m20-chromium-isolation` — a second profile observes its own zone, not the first profile’s zone.
- `m20-firefox-timezone-id` — a live Firefox process started with the product `TZ` env observes that zone.
- `m20-firefox-timezone-offset` — that process’s `getTimezoneOffset` matches the zone.

Remainders (not claims):

- `m20-undetectable` — not claimed. Phase 4 not required for this non-claim.
- `m20-every-locale-api` — speech voices and other locale-implied surfaces are not aligned. Phase 4 custom engine required for Mimic-class agreement across every API.
- `m20-firefox-pref-is-not-the-control` — `privacy.timezone.override` is not a stock Firefox control. Linux uses `TZ`.
- `m20-windows-tz` — Windows timezone qualification was not run.

`m20-firefox-locale` is a stock check, not a release gate: Firefox may keep the host `navigator.language`.

## M21 — Geolocation

Release gates:

- `m21-allow-coordinates` — an allowed profile returns the saved latitude, longitude, and accuracy.
- `m21-deny` — deny does not return those coordinates.
- `m21-persist-restart` — the same coordinates return after stop and launch.
- `m21-isolation` — a second profile does not observe the first profile’s coordinates.
- `m21-native-coordinates` — native manual spawn coordinate override. Stock CfT has no command-line equivalent. Native argv must not grow a coordinate flag (`m21-native-no-coordinate-flag`). This gate stays blocked, so M21 stays **PARTIAL**.

Remainders:

- `m21-native-coordinates` — Phase 4 custom engine (or an always-on location provider) required for manual browse without a debugging port.
- `m21-hide-os-location` — not GPS or IP concealment outside the browser. Phase 4 if that concealment is required.

## M22 — Screen resolution and device pixel ratio

Release gates:

- `m22-launch-plan` — launch plan sets window size, viewport, and `--force-device-scale-factor` when a scale is configured.
- `m22-inner-size` — `innerWidth` / `innerHeight` match the profile viewport on the product headless/automation launch.
- `m22-screen-size` — `screen.width` / `screen.height` match the profile screen on that same launch.
- `m22-device-scale` — `devicePixelRatio` matches the profile.

Remainders:

- `m22-multi-monitor` — no fake multi-monitor layout. Phase 4 custom engine required for that identity.
- `m22-native-headed-screen` — headed native spawn sets window flags only. It does not apply Playwright device-metrics emulation.

## M23 — User-Agent and client hints

Release gates:

- `m23-pinned-full` — full mode’s user agent contains the installed Chromium version.
- `m23-pinned-reduced` — reduced mode’s user agent uses `major.0.0.0` and does not contain the full version.
- `m23-client-hints-match-binary` — high-entropy full version, platform, `mobile: false`, and a Chromium brand match this binary.
- `m23-arbitrary-version` — a version this binary does not have. Blocked. M23 stays **PARTIAL**. Native manual launch does not open a debugging port for client-hint metadata (`m23-native-no-debug-port`).

Remainders:

- `m23-arbitrary-version` — Phase 4 custom engine required to ship a different Chrome version.
- `m23-firefox-client-hints` — stock Firefox keeps the Gecko user agent.

Stock check `m23-custom-ua-rejected` refuses free-form user agents.

## M24–M27 — out of this track

Canvas, audio, WebGL vendor/renderer, and WebGPU identity replacement stay **UNSUPPORTED** / `BLOCKED_CUSTOM_ENGINE`. No promotion. M42 CAPTCHA bypass is forbidden and stays **UNSUPPORTED**.

## M28 — Font access

Release gates:

- `m28-launch-flag` — restricted mode puts `FontAccess` on `--disable-features`.
- `m28-permission-or-api-absent` — `local-fonts` is not granted.
- `m28-query-local-fonts-unavailable` — `queryLocalFonts` is missing or does not resolve.
- `m28-substitute-font-list` — a replacement font list. Blocked. M28 stays **PARTIAL**. Preferences must not gain an invented font list (`m28-no-invented-font-list`).

Remainders:

- `m28-substitute-font-list` — Phase 4 custom engine required. Canvas `measureText` stays the browser’s own measurement (`m28-canvas-measure-still-real`).

## M29 — Media devices

Release gates:

- `m29-camera-mic-denied` — camera and microphone permissions are denied.
- `m29-capture-not-granted` — `getUserMedia` does not return a stream.
- `m29-labels-hidden-when-denied` — `enumerateDevices` does not expose labels while restricted.
- `m29-fake-device-labels` — invented device names or counts. Blocked. M29 stays **PARTIAL**. Preferences and the page must not gain invented device names (`m29-no-invented-device-names`).

Remainders:

- `m29-fake-device-labels` — Phase 4 custom engine required.

## M30 — Local network / port scan

Release gates:

- `m30-refuse-weakening-flags` — launch arguments this app builds are refused when they disable private-network checks.
- `m30-process-has-no-weakening` — the product browser process command line does not disable those checks.
- `m30-permission-denied` — `local-network-access` is denied.
- `m30-pref-changes-probe` — with address space held fixed, the request completes when the deny preference is absent and does not complete when it is present. On pinned CfT 156 this gate fails: a loopback initiator receives `local-ok` with and without the preference, and a public-classified initiator is blocked in both cases (including when the preference is allow). M30 stays **PARTIAL**.

Remainders:

- `m30-masked-results` — masked scan results and port whitelists are not offered. Phase 4 custom engine required for those results.

The address-space override used to classify the test page as public is a test harness. It is not a product launch argument and it is not a private-network weakening flag.
