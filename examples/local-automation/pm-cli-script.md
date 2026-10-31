# pm-cli JSON scripts and node exec

Requires a running Profile Manager API (`PM_API_TOKEN`, optional `PM_API_BASE`).

```bash
export PM_API_TOKEN=your-token
npm run pm-cli -- --json run @examples/local-automation/pm-cli-script.json
npm run pm-cli -- exec examples/local-automation/exec-cdp-title.mjs <profile-uuid>
```

- **run** executes declarative HTTP steps against `/api/v1`. Bindings are `{{stepId.field}}` only. There is no shell.
- **exec** runs `node` on one `.mjs`, `.js`, or `.cjs` file with `shell: false`. When a running Chromium profile id is passed, `PM_CDP_HTTP` is set to that profile's CDP endpoint. The API token is not placed on the script argv.
- `--json` prints success JSON on stdout and `{ "ok": false, "error", "code", "status" }` on stderr.

`exec-cdp-title.mjs` is for authorized local UI testing. It reads the open page title and disconnects. It does not stop the profile.
