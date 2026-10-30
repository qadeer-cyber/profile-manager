# Phase Two — stock browser fingerprint surfaces (research)

**Scope:** What Multilogin-style canvas / audio / WebGL / WebGPU masking implies vs what **stock Chromium (CfT pin)** and **stock Firefox** can do locally in Profile Manager — **no custom antidetect fork**, no invented spoofing claims.

**Reference (public):** Multilogin help describes fingerprint “masking” and engine-specific patches (Mimic / Stealthfox). This product uses **stock** engines only.

## Summary matrix

| Surface | Multilogin-class claim | Stock Chromium (local) | Stock Firefox (local) | Local PM status |
|--------|-------------------------|-------------------------|------------------------|-----------------|
| **WebGL vendor/renderer** | Mask GPU strings | Real GPU or `--disable-webgl` | Real GPU; limited prefs | **PARTIAL** — restrict only (`fingerprint-settings.js`) |
| **Canvas readback** | Noise / consistent fake | No supported noise API in pinned CfT | No noise API | **UNSUPPORTED** — real readback only |
| **AudioContext** | Noise / fingerprint hash | No supported noise API | No supported noise API | **UNSUPPORTED** — real render only |
| **WebGPU** | Mask adapter/device | `navigator.gpu` observed; disable switch not verified useful on test host | Similar stock behavior | **UNSUPPORTED** for mask; observation only |
| **Fonts enumeration** | Substitute list | Deny `local-fonts` permission only | System fonts | **PARTIAL** — deny permission, not list spoof |
| **Media devices** | Fake cam/mic labels | Deny camera/mic permissions | Permission prefs | **PARTIAL** — deny only |
| **Navigator / client hints** | Full spoof | UA presets tied to **real** CfT version | UA/TZ/locale prefs | **PARTIAL** — no version lie |
| **WebRTC IP** | Hide / fake IP | Chromium IP-handling **policies** only | Gecko ICE prefs mapping | **PARTIAL** — not anonymous guarantee |

## Blockers to “Multilogin-equivalent” without a custom engine

1. **Canvas / WebGL image / Audio noise** require injected rendering changes (custom Chromium builds or extensions with deep hooks). Stock flags do not expose Multilogin-style noise.
2. **WebGPU identity replacement** is not available as a supported launch switch; disabling features did not yield a testable “off” adapter on the Linux CfT host used in CI notes.
3. **Font list spoofing** beyond permission denial would need engine patches or persistent content-script injection — not offered as antidetect.
4. **Firefox “Stealthfox”** parity implies Mozilla-tree patches; PM uses stock Firefox + documented `user.js` prefs only.

## Feasible next steps (stock-only)

- Keep **rejecting** invalid fingerprint modes in API/UI (`FINGERPRINT_REJECTED`).
- Expand **observable tests** (CDP / diagnostics) documenting real values when profiles launch — evidence, not spoofing.
- Document **honest limits** in profile editor + `GET /api/fingerprint-catalog` (already wired).
- Optional: **WebGL off** + **local-fonts deny** regression tests in launch-plan tests (existing partial coverage).

## Out of scope for Phase Two in this repo

- Paid custom Chromium forks, Mimic/Stealthfox builds, or cloud fingerprint services.
- Claims of “undetectable” or bandwidth/traffic-saver features without measurable APIs.

**Audit date:** Oct 2026 · Branch: `feature/dedicated-browser-engine`
