# Custom Chromium-derived browser — feasibility (Phase 3)

## Current state

- **Shipped binary:** Chromium for Testing (Playwright revision pin), not a fork.
- **Manual path:** Stock `chrome.exe` / `chrome` with PM-composed flags — **no source compile**.

## Windows build requirements (reference)

| Item | Estimate |
|------|----------|
| Disk | ~100 GB checkout + out |
| RAM | 16 GB minimum; 32 GB recommended for link |
| Time | First full build often 4–8+ hours on fast desktop |
| Toolchain | VS 2022, Windows 10 SDK, depot_tools, `gclient` sync |

**Latitude 5480 (8 GB RAM):** Not suitable as a Chromium compile host without heavy swap and multi-day builds. **Do not assume owner laptop compiles Chromium.**

## GitHub Actions `windows-2022`

- **Blocker:** Job time limits, ~14 GB RAM, no persistent 100 GB artifact cache for full Chromium tree.
- **Verdict:** Full custom Chromium build in GHA is **BLOCKED** for this repo without dedicated build infra (approval + cost).

## without-fork vs source modifications

| Approach | Mimic-comparable features | Cost |
|----------|---------------------------|------|
| **Config + spawn (current Phase 1)** | Real supported flags/prefs only | Low |
| **Chromium feature flags / enterprise policies** | Partial (WebRTC, WebGL off, extensions) | Low |
| **Blink/renderer patches (canvas noise, navigator overrides)** | High parity with commercial antidetect | High — custom build + CVE merge burden |

## Packaging / integrity / CVE

- Today: SHA-256 pinned zip from Playwright CDN (`chromium-manifest.json`).
- Custom engine would need: dual-slot install, signed updates, merge cadence with Chrome security releases, rollback tested on Win10.

## PoC status

**No custom-built EXE exists.** Do not claim a dedicated compiled engine until one is launched and tested on Windows.

## Recommended next engineering step (if approved)

1. Side-by-side browser slot registry + rollback (extend `update-manager.js`).
2. Owner-machine **native launch smoke** on Latitude (not GHA).
3. Only then evaluate minimal Chromium patch set behind a feature flag — with separate security review.
