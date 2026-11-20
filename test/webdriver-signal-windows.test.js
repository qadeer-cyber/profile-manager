// Option A (owner-approved): ordinary AZWAH Chrome Stable profiles are a genuine manual browser.
//
// Owner evidence on the installed 8607780 build: BrowserScan flagged only WebDriver
// (navigator.webdriver true), Google showed "unusual traffic" on the owner's own IP with no proxy,
// and everyday Chrome on the same network was not challenged. AZWAH kept a Playwright pipe on every
// Chrome Stable profile.
//
// In real, headed Chrome Stable this records navigator.webdriver for each launch mode and checks
// manual profiles end to end. Pages report to a loopback server, so nothing here needs automation:
//   - an ordinary profile launches manually: navigator.webdriver false, no pipe/debugging switch;
//   - cookies, localStorage and IndexedDB written in the manual browser survive stop and restart;
//   - two manual profiles do not see each other's storage;
//   - a profile with automation enabled stays controlled and reports what Chrome reports (recorded,
//     not concealed);
//   - chrome.exe started directly, with and without a control pipe, for reference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

test('real Chrome Stable: manual profiles are not automation-controlled and keep their data', { timeout: 300000 }, async t => {
  if (process.platform !== 'win32') { t.skip('Chrome Stable runtime is Windows-only'); return; }
  const { resolveWindowsChromeStable } = await import('../server/browser-runtime/chrome-stable.js');
  let stable;
  try { stable = await resolveWindowsChromeStable(); } catch (error) { t.skip(`Chrome Stable not available: ${error.code || error.message}`); return; }

  // GET /<key>?op=seed|check: the page writes or checks its own cookie, localStorage and IndexedDB,
  // then reports navigator.webdriver and what it found.
  const reports = new Map();
  const site = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/report') { reports.set(u.searchParams.get('key'), JSON.parse(u.searchParams.get('data'))); res.end('ok'); return; }
    const key = u.pathname.slice(1).replace(/[^a-z0-9-]/g, '');
    const op = u.searchParams.get('op') || 'check';
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end(`<title>probe</title><script>
(async () => {
  const label = ${JSON.stringify(key.split('-')[0])};
  if (${JSON.stringify(op)} === 'seed') {
    document.cookie = 'probe=' + label + '; Path=/; Max-Age=864000';
    localStorage.setItem('probe', label);
    await new Promise(r => { const q = indexedDB.open('probe-' + label); q.onsuccess = () => { q.result.close(); r(); }; q.onerror = r; });
  }
  const dbs = (await indexedDB.databases()).map(d => d.name);
  const data = { webdriver: String(navigator.webdriver), cookie: document.cookie, local: localStorage.getItem('probe'), idb: dbs.filter(n => n.startsWith('probe-')) };
  fetch('/report?key=${key}&data=' + encodeURIComponent(JSON.stringify(data)));
})();</script>`);
  });
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${site.address().port}`;
  const waitFor = async key => { for (let i = 0; i < 160 && !reports.has(key); i++) await new Promise(r => setTimeout(r, 250)); return reports.get(key) ?? null; };
  const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-webdriver-'));
  const results = {};

  const dir = temp();
  process.env.PM_DATA_DIR = dir;
  process.env.PM_API_TOKEN = 'webdriver-token';
  const { startServer } = await import('../server/app.js');
  const { launchEvidence } = await import('../server/browsers.js');
  const server = await startServer({ port: 0, staticDir: null });
  const api = async (method, route, body) => {
    const r = await fetch(server.url + '/api/v1' + route, { method, body: body && JSON.stringify(body),
      headers: { Authorization: 'Bearer webdriver-token', 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(90000) });
    const data = await r.json().catch(() => null);
    assert.ok(r.ok, `${method} ${route}: ${r.status} ${JSON.stringify(data)}`);
    return data;
  };
  const visit = async (id, key, op) => {
    const launched = await api('POST', `/profiles/${id}/launch`, { headless: false, url: `${origin}/${key}?op=${op}` });
    const report = await waitFor(key);
    const args = launchEvidence(id)?.requestedArgs || [];
    return { launched, report, args };
  };
  try {
    // Two ordinary profiles: no proxy, timezone, coordinates, emulation or automation.
    const A = await api('POST', '/profiles', { name: 'manual A', advancedSettings: { runtime: 'stable-chrome' } });
    const B = await api('POST', '/profiles', { name: 'manual B', advancedSettings: { runtime: 'stable-chrome' } });
    const a1 = await visit(A.id, 'a-seed', 'seed');
    results.manual = a1.report?.webdriver ?? 'no-report';
    assert.ok(a1.report, 'manual profile page reported');
    assert.equal(a1.launched.cdp, undefined, 'a manual launch exposes no automation endpoint');
    for (const flag of ['--remote-debugging-pipe', '--remote-debugging-port', '--enable-automation', '--disable-blink-features']) {
      assert.equal(a1.args.some(arg => String(arg).startsWith(flag)), false, `manual launch has no ${flag}`);
    }
    assert.equal(a1.report.webdriver, 'false', 'navigator.webdriver in a manual AZWAH profile');

    // B runs at the same time and must not see A's storage.
    const b1 = await visit(B.id, 'b-check', 'check');
    assert.deepEqual([b1.report.webdriver, b1.report.cookie, b1.report.local, b1.report.idb], ['false', '', null, []], 'B does not see A');
    await api('POST', `/profiles/${B.id}/stop`);
    // A is unaffected by B stopping, and keeps its data across its own restart.
    await api('POST', `/profiles/${A.id}/stop`);
    const a2 = await visit(A.id, 'a-again', 'check');
    assert.deepEqual([a2.report.webdriver, a2.report.cookie, a2.report.local, a2.report.idb], ['false', 'probe=a', 'a', ['probe-a']], 'A data after restart');
    await api('POST', `/profiles/${A.id}/stop`);

    // A profile that asks for automation stays controlled; what Chrome reports there is recorded.
    const C = await api('POST', '/profiles', { name: 'controlled C', automationEnabled: true, advancedSettings: { runtime: 'stable-chrome' } });
    const c1 = await visit(C.id, 'c-check', 'check');
    assert.ok(c1.launched.cdp?.httpEndpoint, 'automation profile exposes its endpoint');
    results.controlledAutomation = c1.report?.webdriver ?? 'no-report';
    await api('POST', `/profiles/${C.id}/stop`);
  } finally {
    await server.close();
  }

  // Reference: chrome.exe started directly, with and without a control pipe.
  const direct = async (key, extra, stdio = 'ignore') => {
    const child = spawn(stable.path, ['--no-first-run', '--no-default-browser-check', `--user-data-dir=${temp()}`, ...extra, `${origin}/${key}?op=check`], { stdio, windowsHide: false });
    try { results[key] = (await waitFor(key))?.webdriver ?? 'no-report'; } finally { child.kill(); await new Promise(r => setTimeout(r, 1500)); }
  };
  await direct('plain', []);
  await direct('pipeonly', ['--remote-debugging-pipe'], ['ignore', 'ignore', 'ignore', 'pipe', 'pipe']);
  site.close();
  console.log('WEBDRIVER_SIGNAL ' + JSON.stringify({ chrome: stable.version, results }));
  assert.equal(results.plain, 'false', 'reference: chrome.exe started like a person starts it');
});
