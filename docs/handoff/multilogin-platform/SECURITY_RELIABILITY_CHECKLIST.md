# Security and reliability checklist (Phase E — local product)

**Branch:** `feature/dedicated-browser-engine`  
**Scope:** Local Windows desktop app; no cloud runtime dependencies.

## Security

| Area | Control | Evidence |
|------|---------|----------|
| API auth | Bearer token for `/api/v1`; UI token for browser routes | `server/app.js`, Settings → Automation API |
| Secrets at rest | Proxy passwords encrypted; optional backup encryption | `secrets.js`, `backup-crypto.js` |
| CDP exposure | Automation port only when `automationEnabled` + launch with automation | `browsers.js`, profile editor toggle |
| Backup safety | Refuses running profiles; path traversal blocked; SHA256 archive entries | `backup.js`, `archive.js`, tests |
| Trash / purge | Await stop; refuse purge while running | `profile-lifecycle.js`, trash tests |
| Provider APIs | No secrets in JSON responses; mock CI for Bright/Oxy/Webshare | `proxy-providers.test.js` |
| ADB | Read-only device list; no remote farm control | `adb-adapter.js`, Settings UI |
| CAPTCHA / abuse | M42 UNSUPPORTED; CookieRobot URL blocklist | `cookie-robot-url.js`, matrix M42 |

## Reliability

| Area | Control | Evidence |
|------|---------|----------|
| Launch locks | Per-profile dir lock; stale recovery | `browsers.js`, M17 tests |
| Graceful shutdown | Stop awaits process; health monitor | `browsers.js` |
| Restore rollback | DB transaction + file undo on failure | `backup.test.js` |
| Regional locale | Fail-closed on broken CDP locale attach | `regional-locale.js`, browser tests |
| Resource guards | maxRunningProfiles, minFreeMemoryGiB, launch queue | Settings defaults for Latitude class |
| Chromium update | Dual-slot backup before reinstall | `update-manager.test.js` |

## Owner gates (not automated)

- Preview installer publish (§19) — **NO-GO** until explicit sign-off.
- Custom Chromium compile — **BLOCKED** (`CUSTOM_ENGINE_BLOCKER_INVENTORY.md`).
- Physical Latitude benchmark numbers — owner-run only (`LATITUDE_BENCHMARK_PACKAGE.md`).
