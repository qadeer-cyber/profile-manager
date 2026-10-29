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

### Verified run (windows-2022)

| Field | Value |
|-------|--------|
| **Actions** | https://github.com/qadeer-cyber/profile-manager/actions/runs/40934718409 |
| **SHA** | `98dbc0c` (loopback bypass fix; feature stack from `cd72dfb`) |
| **engine-windows** | success |
| **installer-smoke-offline** | success — offline build, Alpha.3→branch upgrade **8/8**, `electron-smoke-offline.js` **45/0** |
| **Release publish** | not run |

Prior failed run **40933139496** (`cd72dfb`): `electron-smoke-offline.js` failed **1** assert — packaged native launch missing `--proxy-bypass-list=<-loopback>` (fixed in `98dbc0c`).

## Current status

**NO-GO preview publish** — automated gates **1–4** and **6** have green CI evidence at `98dbc0c`; **gate 7 (owner sign-off)** and product blockers (bundled chromedriver/geckodriver **MISSING**, custom Chromium **BLOCKED**) remain.

**§19 movement:** installer path is **proven on GHA** without publishing; preview tag still requires human approval, not CI alone.
