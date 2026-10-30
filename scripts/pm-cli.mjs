#!/usr/bin/env node
/** Local Profile Manager CLI (automation + UI API). Requires PM_API_TOKEN; optional PM_API_BASE / PM_UI_BASE. */
import fs from 'node:fs';

const base = (process.env.PM_API_BASE || 'http://127.0.0.1:3847/api/v1').replace(/\/$/, '');
const uiBase = (process.env.PM_UI_BASE || base.replace(/\/api\/v1\/?$/, '/api')).replace(/\/$/, '');
const token = process.env.PM_API_TOKEN || '';
const jsonMode = process.argv.includes('--json');
const rawArgs = process.argv.slice(2).filter(a => a !== '--json');

const EXIT = { OK: 0, ERROR: 1, USAGE: 2 };

function usage() {
  console.log(`Profile Manager pm-cli — local API automation

Usage: pm-cli [--json] <command> [args]

Profiles (v1):
  list [query]                 List profiles (?q= & ?workspaceId= as key=value)
  show <id>                    Get one profile
  create <json|@file>          Create profile (POST /profiles)
  update <id> <json|@file>     Patch profile (browserSettings, advancedSettings, …)
  delete <id>                  Soft-delete to trash
  clone <id> [name]            Clone profile
  launch <id> [json]           Launch (default automation:true for v1)
  stop <id>                    Stop profile
  restart <id> [json]          stop then launch
  running                      List running profile ids
  launch-status <id>           Launch queue / state

Trash (/api UI):
  trash-list                   List trashed profiles
  trash-restore <id>           Restore from trash
  trash-purge <id> <name>      Permanent purge (confirmName)

Workspaces (v1):
  workspaces [q]               List workspaces (optional name filter)
  workspace-create <json|@>    Create workspace
  workspace-update <id> <json>
  workspace-delete <id>
  workspace-export <id>        Export metadata bundle
  workspace-import <json|@>    Import metadata; re-link profiles by id
  workspace-assign <profileId> <workspaceId|null>
  workspace-bulk-assign <wsId> <id,id,...>

Proxy & extensions (v1):
  proxies [tag]                List library proxies
  proxy-summary                Library health summary
  proxy-assign <profileId> <proxyId|null>
  extensions                   List extension library
  extension-assign <profileId> <extensionId> [true|false enabled]

Cookies & backup (v1):
  cookies <id>                 List cookies (stopped profile)
  cookies-export <id>          JSON export to stdout
  backup-export <id>           Portable .pmp bytes → stdout (binary; use --json for metadata-only note)

Automation & diagnostics:
  schema                       Profile config JSON schema
  config <id>                  Browser-config document
  validate <json|@>             POST profile-config/validate
  cookie-robot                 CookieRobot capability report
  human-input                  Human input capability report
  bridges                      WebDriver + geckodriver reports
  automation-drivers           Cached driver install report
  diagnostics                  Server diagnostics (/api)
  dashboard                    Dashboard stats (v1)

Other:
  adb-devices                  List adb devices (/api)
  adb-diagnostics              Connection diagnostics + recovery hints
  adb-info <serial>            Read-only device getprop snapshot
  adb-connect <host:port>      Network adb connect
  adb-disconnect [serial]      Disconnect target or all
  adb-select <serial|null>     Persist selected device for UI
  type <id> <text...>          Human-input keystrokes (Chromium, running)
  help                         This help

Env: PM_API_TOKEN (required), PM_API_BASE, PM_UI_BASE, PM_TYPE_WPM
Exit: 0 success, 1 API/runtime error, 2 usage; HTTP 4xx often maps to exit code = status.`);
}

async function api(method, path, body, { ui = false, raw = false } = {}) {
  if (!token) {
    const err = new Error('Set PM_API_TOKEN');
    err.code = 'MISSING_TOKEN';
    throw err;
  }
  const root = ui ? uiBase : base;
  const headers = { Authorization: `Bearer ${token}` };
  let payload;
  if (raw) {
    payload = body;
    if (!(body instanceof Buffer) && !(body instanceof Uint8Array)) headers['Content-Type'] = 'application/octet-stream';
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const r = await fetch(`${root}${path}`, { method, headers, body: payload });
  if (raw) {
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok) {
      let parsed;
      try { parsed = JSON.parse(buf.toString('utf8')); } catch { parsed = { error: buf.toString('utf8').slice(0, 200) }; }
      const err = new Error(parsed.error || parsed.message || `HTTP ${r.status}`);
      err.code = parsed.code;
      err.status = r.status;
      throw err;
    }
    return buf;
  }
  const text = await r.text();
  let parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  }
  if (!r.ok) {
    const err = new Error(parsed?.error || parsed?.message || text || `HTTP ${r.status}`);
    err.code = parsed?.code;
    err.status = r.status;
    throw err;
  }
  if (r.status === 204) return null;
  return parsed;
}

function out(value) {
  if (jsonMode) console.log(JSON.stringify(value, null, 2));
  else if (typeof value === 'string') console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

function readJsonArg(spec, label) {
  if (!spec) throw Object.assign(new Error(`${label} requires JSON body or @file`), { exitCode: EXIT.USAGE });
  const s = spec.startsWith('@') ? fs.readFileSync(spec.slice(1), 'utf8') : spec;
  try { return JSON.parse(s); } catch {
    throw Object.assign(new Error(`Invalid JSON for ${label}`), { exitCode: EXIT.USAGE });
  }
}

function parseListQuery(arg) {
  if (!arg || arg.includes('=')) {
    const qs = new URLSearchParams(arg || '');
    return qs.toString() ? `?${qs}` : '';
  }
  return `?q=${encodeURIComponent(arg)}`;
}

function exitFromError(e) {
  console.error(e.message || String(e));
  if (e.exitCode === EXIT.USAGE) process.exit(EXIT.USAGE);
  const st = e.status;
  if (typeof st === 'number' && st >= 2 && st <= 254) process.exit(st);
  process.exit(EXIT.ERROR);
}

const [cmd, arg, arg2, arg3, ...rest] = rawArgs;

try {
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    usage();
    process.exit(EXIT.OK);
  }

  if (cmd === 'list') {
    const rows = await api('GET', `/profiles${parseListQuery(arg)}`);
    if (jsonMode) out(rows);
    else for (const p of rows) console.log(`${p.id}\t${p.running ? 'RUN' : '---'}\t${p.name}`);
  } else if (cmd === 'show') {
    if (!arg) throw Object.assign(new Error('show requires profile id'), { exitCode: EXIT.USAGE });
    out(await api('GET', `/profiles/${arg}`));
  } else if (cmd === 'create') {
    out(await api('POST', '/profiles', readJsonArg(arg, 'create')));
  } else if (cmd === 'update') {
    if (!arg || !arg2) throw Object.assign(new Error('update requires profile id and JSON'), { exitCode: EXIT.USAGE });
    out(await api('PATCH', `/profiles/${arg}`, readJsonArg(arg2, 'update')));
  } else if (cmd === 'delete') {
    if (!arg) throw Object.assign(new Error('delete requires profile id'), { exitCode: EXIT.USAGE });
    await api('DELETE', `/profiles/${arg}`);
    if (jsonMode) out({ deleted: arg });
  } else if (cmd === 'clone') {
    out(await api('POST', `/profiles/${arg}/clone`, arg2 ? { name: arg2 } : {}));
  } else if (cmd === 'launch') {
    const body = arg2 ? readJsonArg(arg2, 'launch') : { automation: true };
    out(await api('POST', `/profiles/${arg}/launch`, body));
  } else if (cmd === 'stop') {
    out(await api('POST', `/profiles/${arg}/stop`));
  } else if (cmd === 'restart') {
    await api('POST', `/profiles/${arg}/stop`).catch(() => {});
    const body = arg2 ? readJsonArg(arg2, 'restart') : { automation: true };
    out(await api('POST', `/profiles/${arg}/launch`, body));
  } else if (cmd === 'running') {
    out(await api('GET', '/running'));
  } else if (cmd === 'launch-status') {
    out(await api('GET', `/profiles/${arg}/launch-status`));
  } else if (cmd === 'trash-list') {
    out(await api('GET', '/trash', null, { ui: true }));
  } else if (cmd === 'trash-restore') {
    out(await api('POST', `/trash/${arg}/restore`, null, { ui: true }));
  } else if (cmd === 'trash-purge') {
    if (!arg || !arg2) throw Object.assign(new Error('trash-purge requires id and confirmName'), { exitCode: EXIT.USAGE });
    out(await api('DELETE', `/trash/${arg}?confirmName=${encodeURIComponent(arg2)}`, null, { ui: true }));
  } else if (cmd === 'workspaces') {
    const qs = arg ? `?q=${encodeURIComponent(arg)}` : '';
    out(await api('GET', `/workspaces${qs}`));
  } else if (cmd === 'workspace-create') {
    out(await api('POST', '/workspaces', readJsonArg(arg, 'workspace-create')));
  } else if (cmd === 'workspace-update') {
    out(await api('PATCH', `/workspaces/${arg}`, readJsonArg(arg2, 'workspace-update')));
  } else if (cmd === 'workspace-delete') {
    await api('DELETE', `/workspaces/${arg}`);
    if (jsonMode) out({ deleted: arg });
  } else if (cmd === 'workspace-export') {
    out(await api('GET', `/workspaces/${arg}/export`));
  } else if (cmd === 'workspace-import') {
    out(await api('POST', '/workspaces/import', readJsonArg(arg, 'workspace-import')));
  } else if (cmd === 'workspace-assign') {
    const ws = arg2 === 'null' || arg2 === '' ? null : arg2;
    out(await api('POST', `/profiles/${arg}/workspace`, { workspaceId: ws }));
  } else if (cmd === 'workspace-bulk-assign') {
    const ids = (arg2 || '').split(',').map(s => s.trim()).filter(Boolean);
    out(await api('POST', `/workspaces/${arg}/assign-profiles`, { profileIds: ids }));
  } else if (cmd === 'proxies') {
    const rows = await api('GET', `/proxies${arg ? `?tag=${encodeURIComponent(arg)}` : ''}`);
    if (jsonMode) out(rows);
    else for (const p of rows) console.log(`${p.id}\t${p.type}\t${p.host}:${p.port}\t${p.name}`);
  } else if (cmd === 'proxy-summary') {
    out(await api('GET', '/proxies/library/summary'));
  } else if (cmd === 'proxy-assign') {
    const proxyId = arg2 === 'null' || arg2 === '' ? null : arg2;
    out(await api('POST', `/profiles/${arg}/proxy`, { proxyId }));
  } else if (cmd === 'extensions') {
    out(await api('GET', '/extensions'));
  } else if (cmd === 'extension-assign') {
    const enabled = arg3 == null || arg3 === 'true';
    out(await api('POST', `/profiles/${arg}/extensions`, { extensionId: arg2, enabled }));
  } else if (cmd === 'cookies') {
    out(await api('GET', `/profiles/${arg}/cookies`));
  } else if (cmd === 'cookies-export') {
    out(await api('GET', `/profiles/${arg}/cookies/export`));
  } else if (cmd === 'backup-export') {
    if (jsonMode) {
      out({ note: 'Use without --json to write raw .pmp to stdout', profileId: arg });
    } else {
      const buf = await api('POST', `/profiles/${arg}/backup/export`, null, { raw: true });
      process.stdout.write(buf);
    }
  } else if (cmd === 'schema') {
    out(await api('GET', '/profile-config/schema'));
  } else if (cmd === 'config') {
    out(await api('GET', `/profiles/${arg}/browser-config`));
  } else if (cmd === 'validate') {
    out(await api('POST', '/profile-config/validate', readJsonArg(arg, 'validate')));
  } else if (cmd === 'cookie-robot') {
    out(await api('GET', '/cookie-robot', null, { ui: true }));
  } else if (cmd === 'human-input') {
    out(await api('GET', '/human-input', null, { ui: true }));
  } else if (cmd === 'bridges') {
    out({ webdriver: await api('GET', '/webdriver'), geckodriver: await api('GET', '/geckodriver') });
  } else if (cmd === 'automation-drivers') {
    out(await api('GET', '/automation-drivers'));
  } else if (cmd === 'diagnostics') {
    out(await api('GET', '/diagnostics', null, { ui: true }));
  } else if (cmd === 'dashboard') {
    out(await api('GET', '/dashboard'));
  } else if (cmd === 'adb-devices') {
    out(await api('GET', '/adb/devices', null, { ui: true }));
  } else if (cmd === 'adb-diagnostics') {
    out(await api('GET', '/adb/diagnostics', null, { ui: true }));
  } else if (cmd === 'adb-info') {
    if (!arg) throw Object.assign(new Error('adb-info requires serial'), { exitCode: EXIT.USAGE });
    out(await api('GET', `/adb/devices/${encodeURIComponent(arg)}/info`, null, { ui: true }));
  } else if (cmd === 'adb-connect') {
    if (!arg) throw Object.assign(new Error('adb-connect requires host:port'), { exitCode: EXIT.USAGE });
    out(await api('POST', '/adb/connect', { serial: arg }, { ui: true }));
  } else if (cmd === 'adb-disconnect') {
    out(await api('POST', '/adb/disconnect', { serial: arg || '' }, { ui: true }));
  } else if (cmd === 'adb-select') {
    out(await api('PUT', '/adb/selection', { serial: arg === 'null' || !arg ? null : arg }, { ui: true }));
  } else if (cmd === 'type') {
    if (!arg || !arg2) throw Object.assign(new Error('type requires profile id and text'), { exitCode: EXIT.USAGE });
    out(await api('POST', `/profiles/${arg}/human-input`, {
      text: [arg2, ...rest].join(' '),
      wpm: Number(process.env.PM_TYPE_WPM) || undefined,
    }, { ui: true }));
  } else {
    throw Object.assign(new Error(`Unknown command: ${cmd}`), { exitCode: EXIT.USAGE });
  }
} catch (e) {
  exitFromError(e);
}
