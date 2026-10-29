# Firefox / Gecko second runtime

**Scope:** User-installed Firefox (or `settings.firefoxExecutablePath`). **Not** Stealthfox patches.

- Profile dir: `{PM_DATA_DIR}/profiles/{id}/gecko` (separate from Chromium user data).
- Launch: `firefox -no-remote -profile <geckoDir>` + locale/proxy prefs file (no Chrome flags).
- Extensions: **UNSUPPORTED** on Firefox path in this increment.
- Automation: use Playwright Firefox only when explicitly requested (future); manual = native spawn.

Tests: `test/firefox-launch-plan.test.js`
