# M35 — CLI and script execution

**Status: VERIFIED**

## Contract

1. `pm-cli --json run @file` executes 1–30 HTTP steps against `/api/v1`. Bindings are `{{stepId.field}}` only.
2. `--json` errors are one JSON object on stderr: `{ ok: false, error, code, status }`.
3. `pm-cli exec <script.mjs> [profileId]` runs `node` on that file with `shell: false`. The API token is not an argument.
4. When `profileId` is a running Chromium automation profile, `PM_CDP_HTTP` is set. A script can read the open page title and disconnect without stopping the profile.
5. Examples: `examples/local-automation/pm-cli-script.json`, `pm-cli-script.md`, `exec-cdp-title.mjs`.

## Evidence

- `test/pm-cli-script.test.js` — create/show script, JSON usage error, argv does not contain the token.
- `test/pm-cli-exec-cdp.test.js` — exec against a launched headless profile returns the local fixture title. The profile is still running after the script disconnects.
- Existing `test/pm-cli-workflow.test.js` still passes.

## Boundary

`exec` runs a local node file the operator already trusts. It does not start a shell, and it does not grant a sandbox escape. Firefox profiles have no CDP endpoint for this command (`automation-attach` returns `FIREFOX_NO_CDP`).
