# Custom Chromium engine — feasibility (documentation only)

Profile Manager ships **stock Chromium** via Playwright. M10–M12 add honest flags, permissions, and diagnostics — not a fork.

## What stock Chromium cannot do per-profile (today)

- Canvas/audio noise, WebGL vendor/renderer spoof, font list spoof, WebRTC public-IP alignment with proxy, hardwareConcurrency/deviceMemory overrides, OSCPU spoof.

## If you maintained a separate custom engine

| Area | Burden |
|------|--------|
| Security updates | Merge upstream Chrome releases weekly/biweekly; rebuild all platforms; re-run SHA-verified install pipeline. |
| Compatibility | Playwright/CDP version pins must match; breaking changes in launch flags and headless shell. |
| Testing | Full M3–M12 matrix on **Windows 10 + Intel HD 620** (not Linux SwiftShader), plus crash/recovery, proxy auth, extension load, fingerprint consistency. |
| Distribution | Separate from Alpha.2 EXE; no installer work in this repo phase — you would ship signed binaries and document rollback. |
| Legal/compliance | Chromium license notices; no redistribution of Google trademarks; CAPTCHA/anti-bot bypass remains out of scope. |

## Recommendation

Stay on verified stock Chromium until a dedicated engine team owns build, patch, and CVE response. Use `GET /api/fingerprint-capabilities` for supported vs custom-engine features.
