// Runs only on Windows_NT (GitHub windows-2022). Skips elsewhere — not a PASS on Linux.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { chromium } from 'playwright';
import { spawnServer, stopServer } from './_ports.mjs';
import { refreshProcessSnapshot } from '../server/process-snapshot.js';
import { buildProfileProcessMetrics, parseWindowsProcessRows } from '../server/process-catalog.js';

const isWin = process.platform === 'win32';

test('Windows native CI environment', { skip: !isWin }, () => {
  assert.equal(process.env.OS, 'Windows_NT');
  assert.ok(process.arch === 'x64' || process.arch === 'arm64');
});

test('Win32 CIM process snapshot returns chrome rows without fabricating memory', { skip: !isWin, timeout: 60000 }, async () => {
  const snap = await refreshProcessSnapshot({ force: true });
  assert.equal(snap.source, 'win32_cim');
  assert.ok(Array.isArray(snap.rows));
  for (const row of snap.rows) {
    if (!row.workingSetAvailable) assert.equal(row.workingSetBytes, 0);
  }
});

test('two headless profiles, monitoring, recovery API, and data marker on Windows', { skip: !isWin, timeout: 300000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m17-winc-'));
  const server = http.createServer((req, res) => { res.end('ok'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const pageUrl = `http://127.0.0.1:${server.address().port}/`;
  const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm17winci' };
  const auth = { Authorization: 'Bearer m17winci', 'Content-Type': 'application/json' };
  let proc;
  try {
    proc = await spawnServer(env);
    await fetch(proc.url + '/api/settings', { method: 'PUT', headers: auth, body: JSON.stringify({ minFreeMemoryGiB: 0, maxRunningProfiles: 4 }) });
    const a = await (await fetch(proc.url + '/api/v1/profiles', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Win A' }) })).json();
    const b = await (await fetch(proc.url + '/api/v1/profiles', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Win B' }) })).json();
    assert.ok(a.id && b.id, 'profile ids from POST /profiles');
    const launchA = fetch(proc.url + '/api/v1/profiles/' + a.id + '/launch', { method: 'POST', headers: auth, body: JSON.stringify({ headless: true, automation: true, url: pageUrl }) });
    const launchB = fetch(proc.url + '/api/v1/profiles/' + b.id + '/launch', { method: 'POST', headers: auth, body: JSON.stringify({ headless: true, automation: true, url: pageUrl }) });
    const [resA, resB] = await Promise.all([launchA, launchB]);
    assert.equal(resA.status, 200, 'launch A');
    assert.equal(resB.status, 200, 'launch B');
    let mon;
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      mon = await fetch(proc.url + '/api/v1/monitoring?refresh=1', { headers: auth }).then(r => r.json());
      if (mon.totals?.runningProfiles >= 2) break;
      await new Promise(r => setTimeout(r, 500));
    }
    assert.equal(mon.environment.platform, 'win32');
    assert.ok(mon.totals.runningProfiles >= 2, `runningProfiles=${mon.totals.runningProfiles}`);
    const snap = await refreshProcessSnapshot({ force: true });
    const { userDataDir } = await import('../server/db.js');
    const metrics = buildProfileProcessMetrics([
      { id: a.id, userDataDir: userDataDir(a.id) },
      { id: b.id, userDataDir: userDataDir(b.id) },
    ], snap.rows, { platform: 'win32' });
    assert.ok(metrics.profiles.length === 2);
    const recovery = await fetch(proc.url + '/api/v1/recovery-status', { headers: auth }).then(r => r.json());
    assert.equal(typeof recovery.runningRows, 'number');
    await fetch(proc.url + '/api/v1/profiles/' + a.id + '/stop', { method: 'POST', headers: auth });
    await fetch(proc.url + '/api/v1/profiles/' + b.id + '/stop', { method: 'POST', headers: auth });
    fs.writeFileSync(path.join(userDataDir(a.id), 'preserve-win.txt'), 'ok');
    const orphan = await fetch(proc.url + '/api/v1/recovery-status', { headers: auth }).then(r => r.json());
    assert.equal(orphan.runningRows, 0);
    assert.equal(fs.readFileSync(path.join(userDataDir(a.id), 'preserve-win.txt'), 'utf8'), 'ok');
    console.log('M17_WIN_CI concurrent=' + mon.totals.runningProfiles + ' cim_rows=' + snap.rows.length);
  } finally {
    if (proc) await stopServer(proc).catch(() => {});
    await new Promise(r => server.close(() => r()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('built UI renders at 1366x768 without horizontal overflow', { skip: !isWin, timeout: 120000 }, async () => {
  const dist = path.resolve('web/dist');
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'run npm run build first');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.static(dist));
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.goto(url);
    await page.waitForSelector('.app', { timeout: 15000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    assert.equal(overflow, false);
  } finally {
    await browser.close();
    await new Promise(r => server.close(() => r()));
  }
});
