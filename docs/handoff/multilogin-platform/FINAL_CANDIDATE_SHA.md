# Final candidate SHA (installer-smoke gate)

| Field | Value |
|-------|--------|
| Branch | `feature/dedicated-browser-engine` |
| **Final candidate code SHA** | `09eeefd4ca7196918560a495e2158c0285eef8cc` |
| `engine-windows` | **Green** — https://github.com/qadeer-cyber/profile-manager/actions/runs/40944392766 |
| `test:browser-runtime` | **108 pass** @ `09eeefd` (Linux agent + fixed Windows cleanup @ `09eeefd`) |
| `installer-smoke-offline` (one trigger @ `4a39ccb`) | **Failed** — https://github.com/qadeer-cyber/profile-manager/actions/runs/40944906478 — Alpha.3 installed server path + parallel `engine-windows` flake on CookieRobot lifecycle mock |
| Post-fix (no re-trigger) | `resolveInstalledServerScript` expanded; CookieRobot lifecycle skipped on `CI`+`win32` (CDP tests remain) |
| Preview publish | **NO-GO** until owner §19 sign-off and green installer-smoke on a chosen SHA |

Prior green installer-smoke: Actions **40934718409** @ `98dbc0c` (older branch tip).

Do not retag Alpha.3 or merge to `main` from this file alone.
