#!/usr/bin/env node
/** Local Profile Manager CLI (automation API). Requires PM_API_TOKEN and PM_API_BASE. */
const base = process.env.PM_API_BASE || 'http://127.0.0.1:3847/api/v1';
const token = process.env.PM_API_TOKEN || '';

async function api(method, path, body) {
  if (!token) throw new Error('Set PM_API_TOKEN');
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!r.ok) throw new Error(json.error || json.message || text || `HTTP ${r.status}`);
  return json;
}

const [cmd, arg] = process.argv.slice(2);
try {
  if (!cmd || cmd === 'help') {
    console.log(`Usage: pm-cli <command> [id]
Commands: list | launch <id> | stop <id> | schema
Env: PM_API_BASE (default ${base}), PM_API_TOKEN (required)`);
    process.exit(0);
  }
  if (cmd === 'list') {
    const rows = await api('GET', '/profiles');
    for (const p of rows) console.log(`${p.id}\t${p.running ? 'RUN' : '---'}\t${p.name}`);
  } else if (cmd === 'launch') {
    console.log(JSON.stringify(await api('POST', `/profiles/${arg}/launch`, { automation: true }), null, 2));
  } else if (cmd === 'stop') {
    console.log(JSON.stringify(await api('POST', `/profiles/${arg}/stop`), null, 2));
  } else if (cmd === 'schema') {
    console.log(JSON.stringify(await api('GET', '/profile-config/schema'), null, 2));
  } else {
    throw new Error(`Unknown command: ${cmd}`);
  }
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
