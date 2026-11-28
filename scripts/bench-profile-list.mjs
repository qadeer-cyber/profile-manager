// Times the profile list endpoints against a real server with N profiles (default 1000).
// Usage: node scripts/bench-profile-list.mjs [count] [rounds]
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
const N = Number(process.argv[2] || 1000), ROUNDS = Number(process.argv[3] || 5);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-bench-'));
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'bench', PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'], cwd: path.resolve(new URL('..', import.meta.url).pathname) });
let out = '';
const url = await new Promise(r => srv.stdout.on('data', d => { out += d; const m = out.match(/on (http:\/\/[^\s]+)/); if (m) r(m[1]); }));
const H = { Authorization: 'Bearer bench', 'Content-Type': 'application/json' };
const call = async (method, p, body, base = '/api/v1') => { const r = await fetch(url + base + p, { method, headers: H, body: body && JSON.stringify(body) }); if (!r.ok) throw new Error(method + ' ' + p + ' ' + r.status + ' ' + await r.text()); return r.json(); };
process.on('exit', () => srv.kill());
const t0 = performance.now();
for (let done = 0; done < N; done += 100) {
  const profiles = Array.from({ length: Math.min(100, N - done) }, (_, i) => ({ name: `Bench ${done + i}`, folder: `Group ${(done + i) % 10}`, tags: [`t${(done + i) % 7}`], notes: 'bench profile' }));
  const res = await call('POST', '/bulk/import', { format: 'json', profiles });
  if (res.some(x => !x.ok)) throw new Error('import failed ' + JSON.stringify(res.find(x => !x.ok)));
}
console.log(`seeded ${N} profiles in ${Math.round(performance.now() - t0)} ms`);
const cases = [
  ['profile-table page 1 (50)', '/profile-table?page=1&pageSize=50'],
  ['profile-table search "Bench 99"', '/profile-table?q=Bench%2099&pageSize=50'],
  ['profile-table sort by name', '/profile-table?sort=name&dir=asc&pageSize=50'],
  ['profile-table last page', `/profile-table?page=${Math.ceil(N / 50)}&pageSize=50`],
  ['meta (UI route)', '/meta', '/api'],
];
const rows = [];
for (const [label, p, base] of cases) {
  await call('GET', p, undefined, base);
  const times = [];
  for (let i = 0; i < ROUNDS; i++) { const s = performance.now(); await call('GET', p, undefined, base); times.push(performance.now() - s); }
  times.sort((a, b) => a - b);
  rows.push({ label, median: Math.round(times[Math.floor(times.length / 2)]), max: Math.round(times.at(-1)) });
}
console.log(`profiles=${N} rounds=${ROUNDS} (ms, median / max)`);
for (const r of rows) console.log(`  ${r.label.padEnd(36)} ${String(r.median).padStart(6)} / ${r.max}`);
srv.kill(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
