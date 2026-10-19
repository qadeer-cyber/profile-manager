# M2 plan: read-only diagnostics

M2 shows what the running profile is actually using. It does not change the browser, and it does not add a control that spoofs, hides, or bypasses a check.

The page stays the current Diagnostics screen. New facts are read from the running browser and from the launch we already performed. Nothing in this plan is a license to implement the fingerprint controls in [RESEARCH.md](RESEARCH.md).

## What to show

- Browser version and user-agent, both read from the running browser, next to the pinned build in `server/chromium-manifest.json`.
- Timezone and locale, read from the running browser.
- Proxy host, port, and type when one is configured. Never the password. A connectivity check reports reachable or not, the latency, and the observed egress IP when the check itself can see one.
- WebRTC: whether any IP-handling policy was passed on the launch command line, and the candidate types the page can observe. Report the facts. Do not add a policy switch.
- Consistency: version against the manifest, user-agent against that version, timezone and locale against the profile settings once those settings exist. A mismatch is a warning, not a rewrite.
- Fingerprint inspection is read-only. Canvas, WebGL, audio, and client hints are displayed only if the page can already read them. No noise, no blocker, no override.

## How to test

Launch one profile with a proxy and one without. The payload matches CDP `Browser.getVersion`, the command line, and `Intl` for timezone and locale. The proxy password is absent. No WebRTC policy flag appears unless a future, separate decision adds one. A profile that is not running shows an empty observation, not a guessed one.

## Out of scope

Spoofing, evasion, CAPTCHA solving, and a custom Chromium. Those remain the research notes in [RESEARCH.md](RESEARCH.md).
