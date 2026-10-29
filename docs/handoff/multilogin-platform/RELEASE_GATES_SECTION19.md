# §19 Preview installer release gates

**Do not publish** until all required gates pass on **windows-2022** + owner sign-off:

1. `npm run test:browser-runtime` + profile-config + firefox plan — 0 fail  
2. Offline EXE build succeeds (existing `npm run dist:win:offline` / electron-builder offline path)  
3. Upgrade smoke from Alpha.3 data dir — no destructive migration (see `test/electron-smoke-branch-upgrade.js` in CI job `installer-smoke-offline`)  
4. Installed offline smoke (`test/electron-smoke-offline.js`) including bundled Chromium path  
5. Native manual Start verified (log `NATIVE-LAUNCH`) — covered in runtime tests; full EXE path in offline smoke seed phase  
6. No retag of `v0.5.0-alpha.3-m1-m17`  
7. Owner explicit approve for preview tag  
8. **No** `gh release create` from automation until 1–7 are green + sign-off  

## CI evidence (branch only)

Workflow: `.github/workflows/dedicated-browser-engine-win.yml`

| Job | When | Purpose |
|-----|------|---------|
| `engine-windows` | every push | 65 unit/runtime tests + Firefox spawn |
| `installer-smoke-offline` | `[ci:installer-smoke]` commit or `workflow_dispatch` | Build offline EXE, Alpha.3→branch preservation, `electron-smoke-offline.js`; **uploads evidence to step summary only** |

Latest push with `[ci:installer-smoke]` will populate run URL in §23 checkpoint.

## Current status

**NO-GO preview publish** — installer job must finish green on windows-2022; owner sign-off still required. Product gaps remain (bundled chromedriver/geckodriver MISSING, custom Chromium BLOCKED, many Multilogin items PARTIAL/MISSING).

**Closer than prior checkpoint:** gates 2–4 now have an automated, non-publishing CI path on this branch; bookmarks/history export and optional local ADB adapter landed for matrix honesty.
