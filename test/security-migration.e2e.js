// Legacy plaintext proxy secrets get re-encrypted at startup; CDP is off unless automation is enabled.
import { spawn } from 'child_process'; import fs from 'fs'; import os from 'os'; import path from 'path';
import Database from 'better-sqlite3';
import { spawnServer, stopServer, armWatchdog, killTracked, missedGracefulShutdowns } from './_ports.mjs';
armWatchdog(15 * 60 * 1000);
// Server port: OS-assigned unless PM_TEST_PORT is set (B is re-read after every restart).
let B; const UI = 'mig-ui';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-mig-'));
const env = { ...process.env, PM_DATA_DIR: dataDir, HEADLESS: '1', PM_API_TOKEN: 'mig-api', PM_UI_TOKEN: UI, PM_PROXY_LOOPBACK: '1' };
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', m); };
const ui = (m, p, b) => fetch(B + '/api' + p, { method: m, headers: { 'x-ui-token': UI, 'content-type': 'application/json' }, body: b && JSON.stringify(b) });
const start = async () => { const s = await spawnServer(env); B = s.url; return s; };
let s = await start();
try {
  const p = await (await ui('POST', '/profiles', { name: 'Legacy', proxy: { type: 'http', host: '127.0.0.1', port: 1, username: 'u', password: 'placeholder' } })).json();
  const PW = 'legacy-plain-pw';
  await stopServer(s);
  const db = new Database(path.join(dataDir, 'profiles.db'));
  const v6 = db.prepare("SELECT name FROM sqlite_master WHERE name='proxies'").get();
  if (v6) { const id = db.prepare('SELECT id FROM proxies LIMIT 1').get()?.id;
    if (id) db.prepare('UPDATE proxies SET password=? WHERE id=?').run(PW, id);
    else { const cols = db.prepare('PRAGMA table_info(proxies)').all().map(c => c.name); console.log('proxies cols', cols); }
  } else db.prepare('UPDATE profiles SET proxy=? WHERE id=?').run(JSON.stringify({ type: 'http', host: '127.0.0.1', port: 1, username: 'u', password: PW }), p.id);
  db.close();
  s = await start();
  await stopServer(s);
  let leak = false; for (const f of ['profiles.db', 'profiles.db-wal']) { const fp = path.join(dataDir, f); if (fs.existsSync(fp) && fs.readFileSync(fp).includes(PW)) leak = f; }
  ok(!leak, 'raw-byte scan: plaintext absent from profiles.db and -wal after startup (' + (leak || 'clean') + ')');
  const rd = new Database(path.join(dataDir, 'profiles.db'), { readonly: true });
  const stored = v6 ? (rd.prepare('SELECT password FROM proxies LIMIT 1').get()?.password || '') : JSON.parse(rd.prepare('SELECT proxy FROM profiles WHERE id=?').get(p.id).proxy || '{}').password || '';
  rd.close();
  ok(/^(enc|ss):v1:/.test(stored), 'legacy plaintext re-encrypted (stored=' + stored.slice(0, 8) + ')');
  s = await start();
  const txt = await (await ui('GET', '/profiles/' + p.id)).text();
  ok(!txt.includes(PW), 'legacy password not exposed via API');
  // CDP gating
  const q = await (await ui('POST', '/profiles', { name: 'NoAuto' })).json();
  const l = await (await ui('POST', `/profiles/${q.id}/launch`, { headless: true })).json();
  ok(!l.cdp && !(l.wsEndpoint), 'CDP not exposed when automation_enabled=0 (finding #4)');
  await ui('POST', `/profiles/${q.id}/stop`);
} catch (e) { ok(false, 'unexpected: ' + e.message); }
finally {
  if (s) await stopServer(s);
  killTracked();
  fail += missedGracefulShutdowns();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
