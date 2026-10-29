# Final candidate SHA (installer-smoke gate)

| Field | Value |
|-------|--------|
| Branch | `feature/dedicated-browser-engine` |
| **Final candidate SHA (Phase F)** | `b3349af0fd236cb7a4898dd5083eca5e2210840b` |
| Code base | `7ec31c4` + `25c8eda` (asar server path, CDP tab reuse), `1187400` (lifecycle skip), `b3349af` (post-upgrade migration start in smoke) |
| `engine-windows` | **Green** — https://github.com/qadeer-cyber/profile-manager/actions/runs/40950595111 |
| `installer-smoke-offline` | **Green** (Phase F) — same run — Alpha.3→branch **7/7**, `electron-smoke-offline.js` **45/0** |
| Phase F triggers | `2a01c2e` failed (schema 12 — migrations need first launch); fixed @ `b3349af` |
| Prior failed trigger | `4a39ccb` run 40944906478 (pre-asar path) |
| Preview publish | **NO-GO** until owner §19 sign-off (gate 7) |

Alpha.3 frozen: `v0.5.0-alpha.3-m1-m17` — not retagged.

Do not merge to `main` or publish from this file alone.
