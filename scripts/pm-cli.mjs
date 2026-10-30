#!/usr/bin/env node
/** Local Profile Manager CLI (automation API). Requires PM_API_TOKEN and PM_API_BASE. */
const base = process.env.PM_API_BASE || 'http://127.0.0.1:3847/api/v1';
const uiBase = process.env.PM_UI_BASE || base.replace(/\/api\/v1\/?$/, '/api');
const token = process.env.PM_API_TOKEN || '';
const jsonMode = process.argv.includes('--json');

async function api(method, path, body, { ui = false } = {}) {
  if (!token) throw new Error('Set PM_API_TOKEN');
  const root = ui ? uiBase : base;
  const r = await fetch(`${root}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  if (!r.ok) {
    const err = new Error(parsed.error || parsed.message || text || `HTTP ${r.status}`);
    err.code = parsed.code;
    err.status = r.status;
    throw err;
  }
  return parsed;
}

const args = process.argv.slice(2).filter(a => a !== '--json');
const [cmd, arg, arg2, arg3] = args;

function out(value) {
  if (jsonMode) console.log(JSON.stringify(value, null, 2));
  else if (typeof value === 'string') console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

try {
  if (!cmd || cmd === 'help') {
    console.log(`Usage: pm-cli [--json] <command> [args]
Commands:
  list                         List profiles
  launch <id>                  Launch with automation (CDP / marionette)
  stop <id>                    Stop profile
  clone <id> [name]            Clone profile
  trash-list                   List trashed profiles (UI API)
  workspaces                   List workspaces
  workspace-export <id>        Export workspace metadata JSON
  schema                       GET /profile-config/schema
  config <id>                  GET browser-config document
  type <id> <text>             Human-input keystrokes (Chromium CDP, profile running)
  cookie-robot                 CookieRobot capability report
  human-input                  Human input capability report
  bridges                      WebDriver bridge reports
  proxies [tag]                List saved proxies
  adb-devices                  List local adb devices (UI API)
Env: PM_API_BASE, PM_UI_BASE (optional), PM_API_TOKEN (required)`);
    process.exit(0);
  }
  if (cmd === 'list') {
    const rows = await api('GET', '/profiles');
    if (jsonMode) out(rows);
    else for (const p of rows) console.log(`${p.id}\t${p.running ? 'RUN' : '---'}\t${p.name}`);
  } else if (cmd === 'launch') {
    out(await api('POST', `/profiles/${arg}/launch`, { automation: true }));
  } else if (cmd === 'stop') {
    out(await api('POST', `/profiles/${arg}/stop`));
  } else if (cmd === 'clone') {
    out(await api('POST', `/profiles/${arg}/clone`, arg2 ? { name: arg2 } : {}));
  } else if (cmd === 'trash-list') {
    out(await api('GET', '/trash', null, { ui: true }));
  } else if (cmd === 'workspaces') {
    out(await api('GET', '/workspaces', null, { ui: true }));
  } else if (cmd === 'workspace-export') {
    if (!arg) throw new Error('workspace-export requires workspace id');
    out(await api('GET', `/workspaces/${arg}/export`, null, { ui: true }));
  } else if (cmd === 'schema') {
    out(await api('GET', '/profile-config/schema'));
  } else if (cmd === 'config') {
    if (!arg) throw new Error('config requires profile id');
    out(await api('GET', `/profiles/${arg}/browser-config`));
  } else if (cmd === 'type') {
    if (!arg || arg2 == null) throw new Error('type requires profile id and text');
    out(await api('POST', `/profiles/${arg}/human-input`, { text: args.slice(2).join(' '), wpm: Number(process.env.PM_TYPE_WPM) || undefined }, { ui: true }));
  } else if (cmd === 'cookie-robot') {
    out(await api('GET', '/cookie-robot', null, { ui: true }));
  } else if (cmd === 'human-input') {
    out(await api('GET', '/human-input', null, { ui: true }));
  } else if (cmd === 'bridges') {
    out({ webdriver: await api('GET', '/webdriver'), geckodriver: await api('GET', '/geckodriver') });
  } else if (cmd === 'proxies') {
    const rows = await api('GET', `/proxies${arg ? `?tag=${encodeURIComponent(arg)}` : ''}`);
    if (jsonMode) out(rows);
    else for (const p of rows) console.log(`${p.id}\t${p.type}\t${p.host}:${p.port}\t${p.name}`);
  } else if (cmd === 'adb-devices') {
    out(await api('GET', '/adb/devices', null, { ui: true }));
  } else {
    throw new Error(`Unknown command: ${cmd}`);
  }
} catch (e) {
  console.error(e.message || e);
  process.exit(typeof e.status === 'number' && e.status >= 1 && e.status < 255 ? e.status : 1);
}
