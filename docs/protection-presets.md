# Protection presets (AZWAH Chromium)

Status 2026-11-27. Applies to profiles on AZWAH Chromium only. A preset is a named combination of stored switches, so profiles, backups and the launcher stay compatible (`server/protection-presets.js`).

| Preset | What it sets | What it adds |
|---|---|---|
| Off | every protection off | nothing |
| Standard | every protection the installed build contains: canvas, audio, hardware and graphics identity (which carries the screen, fonts, WebGPU, ClientRects, client hints, media devices and WebRTC address when the build has those patches) | nothing; a protection the build lacks is left off, because the launcher refuses a profile that asks for it |
| Strict | Standard, plus `experimental.strict = on` | fail-closed launch rules |
| Custom | any other mix of the switches | nothing |

Standard is the default for new profiles that run on AZWAH Chromium (editor and API); an explicit choice, including Off, is kept. Existing profiles are never changed.

## What Strict means

Strict protects the same surfaces as Standard. What it adds is a refusal to run with less than the full set. The launcher (`assertStrictLaunchAllowed`, before the browser binary is verified or started) refuses with HTTP 409 and lists every broken rule:

| Rule | Code |
|---|---|
| The profile runs on AZWAH Chromium | `STRICT_REQUIRES_AZWAH_CHROMIUM` |
| A proxy is assigned (otherwise sites see this computer's own IP) | `STRICT_REQUIRES_PROXY` |
| The installed build contains every protection: canvas, identity, audio and screen, fonts and WebGPU, ClientRects and client hints, media devices and WebRTC address | `STRICT_BUILD_INCOMPLETE` |
| Every protection switch is on | `STRICT_PROTECTIONS_OFF` |
| The assigned proxy has not failed its last stored test (an untested proxy is allowed; the launch itself verifies the exit) | `STRICT_PROXY_FAILED` |

Where Strict shows up:

- **Editor:** a third segment. It is disabled, with the missing features in its tooltip, when the build lacks any. Choosing Strict without a proxy is refused at save time with a message pointing to the Proxy tab.
- **Bulk create from a proxy list:** a Strict option, offered only when the build has everything; the server refuses it otherwise.
- **Profile health:** a "Strict protection" row that is OK when every rule holds and one mismatch row per broken rule, so the user sees why a launch would be refused before launching.
- **Already part of every proxy launch on AZWAH Chromium:** the browser checks the proxy exit before opening pages and stops when it changes, and non-proxied WebRTC UDP is disabled. Strict does not duplicate these.

## What Strict does not do

- It is not a stronger masking level. Nothing here makes a profile undetectable; the Health panel reports what was actually measured.
- It does not check the proxy live at launch time beyond what the launcher already does; the proxy rule uses the last stored test.
- It does not cover surfaces without a patch (port-scan masking, speech voices, battery) or WebGPU on real hardware, which has not been observed.

## Verification state

- Preset mapping, Strict rules, validator, health rows and the bulk-create refusal are covered by unit and API tests (`test/protection-presets.test.js`, `test/profile-health.test.js`).
- The launcher guard is tested as a function and checked to run before the binary is verified. It has **not** been run in the Windows CI launch path, and `media-webrtc.patch` and `workers.patch` (two of the six features Strict requires) are not yet compiled, so on today's shipped build Strict is correctly unavailable.

## Open design questions

1. **Per-launch versus per-profile noise.** Canvas, audio and ClientRects seeds are new on every launch, so a returning visitor's fingerprint changes each time. A persistent per-profile seed would look more like a real browser. It changes what "stable" means and needs its own probe; it is not part of Strict.
2. **A live proxy check at launch for Strict.** Refuse when a fresh probe fails, not only when the last stored test did. It adds seconds to every launch.
3. **Strict as a default for proxy profiles** once the full feature set is proven on Windows 10/11 hardware.
