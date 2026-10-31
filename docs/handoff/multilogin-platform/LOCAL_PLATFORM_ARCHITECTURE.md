# Local platform architecture (A–I)

See also `docs/handoff/dedicated-browser-engine/ARCHITECTURE.md`.

| Layer | Component | Status |
|-------|-----------|--------|
| A | Electron desktop shell | VERIFIED |
| B | SQLite profiles + `userDataDir` / gecko subdir | VERIFIED |
| C | Browser runtime: Chromium native + Playwright adapter; Firefox gecko spawn | PARTIAL |
| D | Privacy/fingerprint engine (stock-supported controls) | PARTIAL |
| E | Optional automation (`automation: true` / headless) | VERIFIED |
| F | Update/integrity (`update-manager.js`, manifest pin) | PARTIAL |
| G | Diagnostics (hardware, Google compat export) | VERIFIED |
| H | Migration (`migrations.js`, config engine v2) | PARTIAL |
| I | Build/CI (windows-2022, no local Chromium compile) | PARTIAL |
