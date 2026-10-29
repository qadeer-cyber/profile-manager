# Final candidate SHA (installer-smoke gate)

| Field | Value |
|-------|--------|
| Branch | `feature/dedicated-browser-engine` |
| **Final candidate code SHA** | `7ec31c48c028c96ff0b0f7bd2fa8d553e329a725` (includes `25c8eda` asar + CDP, `1187400` lifecycle skip) |
| `engine-windows` | **Green** @ `7ec31c4` — https://github.com/qadeer-cyber/profile-manager/actions/runs/40947101814 |
| `test:browser-runtime` | **108 pass** (Windows CI @ `7ec31c4`) |
| `installer-smoke-offline` (attempt 1 @ `4a39ccb`) | **Failed** — run 40944906478 (pre-asar path fix) |
| `installer-smoke-offline` (Phase F re-trigger) | *pending* — commit with `[ci:installer-smoke]` on candidate |
| Preview publish | **NO-GO** until owner §19 sign-off and green installer-smoke on a chosen SHA |

Prior green installer-smoke: Actions **40934718409** @ `98dbc0c` (older branch tip).

Do not retag Alpha.3 or merge to `main` from this file alone.
