# §19 Preview installer release gates

**Do not publish** until all required gates pass on **windows-2022** + owner sign-off:

1. `npm run test:browser-runtime` + profile-config + firefox plan — 0 fail  
2. Offline EXE build succeeds (existing `npm run dist:win:offline` / electron-builder offline path)  
3. Upgrade smoke from Alpha.3 data dir — no destructive migration (`test/electron-smoke-branch-upgrade.js`)  
4. Installed offline smoke (`test/electron-smoke-offline.js`) including bundled Chromium path  
5. Native manual Start verified (log `NATIVE-LAUNCH`) — unit/runtime tests + offline smoke plain Launch (native argv under bundled CfT)  
6. No retag of `v0.5.0-alpha.3-m1-m17`  
7. Owner explicit approve for preview tag (+ Latitude physical sign-off when required by release policy)  
8. **No** `gh release create` from automation until 1–7 are satisfied  

## CI evidence (branch only)

Workflow: `.github/workflows/dedicated-browser-engine-win.yml`

| Job | When | Purpose |
|-----|------|---------|
| `engine-windows` | every push | 65 unit/runtime tests + Firefox spawn |
| `installer-smoke-offline` | `[ci:installer-smoke]` or `workflow_dispatch` | Offline EXE build + preservation + installed smoke; **step summary only** |

### §19 gate table (Phase F final candidate)

| # | Gate | Result @ `b3349af` | Evidence |
|---|------|-------------------|----------|
| 1 | `test:browser-runtime` + Firefox spawn | **Pass** | run 40950595111 `engine-windows` |
| 2 | Offline EXE build | **Pass** | same job, SHA-256 step summary |
| 3 | Alpha.3 → branch data preservation | **Pass** | upgrade smoke **7/7** (schema v16, workspaces, Persist row) |
| 4 | Installed offline smoke | **Pass** | `electron-smoke-offline.js` **45/0** |
| 5 | Native manual / loopback proxy argv | **Pass** | offline smoke asserts (incl. `--proxy-bypass-list=<-loopback>`) |
| 6 | No Alpha.3 retag | **Pass** | workflow summary; no `gh release create` |
| 7 | Owner preview sign-off | **Pending** | **NO-GO publish** until human approval |
| 8 | No automated publish | **Pass** | branch-only CI |

**Actions (authoritative):** https://github.com/qadeer-cyber/profile-manager/actions/runs/40950595111

Prior green @ `98dbc0c` (run 40934718409). Failed attempts: `4a39ccb` (40944906478, asar path), `2a01c2e` (40948956865, migration-not-run until first launch — fixed in smoke test @ `b3349af`).

## Current status

**NO-GO preview publish** — automated gates **1–6** and **8** are green on final candidate **`b3349af`**; **gate 7 (owner sign-off)** remains. ChromeDriver/geckodriver: **opt-in cache** under data dir (`AUTOMATION_DRIVERS.md`), not bundled in the offline EXE. Custom Chromium **BLOCKED**.
