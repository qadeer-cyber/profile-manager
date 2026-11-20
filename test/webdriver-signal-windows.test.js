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

test('real Chrome Stable: manual profiles are not automation-controlled and keep their data', { timeout: 900000 }, async t => {
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
    if (u.pathname === '/ping') { res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }).end('pong'); return; }
    const key = u.pathname.slice(1).replace(/[^a-z0-9-]/g, '');
    const op = u.searchParams.get('op') || 'check';
    if (op === 'cycle') {
      // Reads what the previous cycle wrote, then writes this cycle's values.
      const n = Number(u.searchParams.get('n'));
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end(`<title>cycle</title><script>
const prev = { cookie: (document.cookie.match(/cycle=(\\d+)/) || [])[1] || null, local: localStorage.getItem('cycle') };
document.cookie = 'cycle=${n}; Path=/; Max-Age=864000';
localStorage.setItem('cycle', '${n}');
fetch('/report?key=${key}&data=' + encodeURIComponent(JSON.stringify({ webdriver: String(navigator.webdriver), prev })));</script>`);
      return;
    }
    if (op === 'dns') {
      // Looks up a real public hostname. With MAP * ~NOTFOUND the lookup must fail inside Chrome.
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end(`<title>dns</title><script>
fetch('http://example.com/', { mode: 'no-cors', cache: 'no-store' }).then(() => 'resolved', () => 'blocked')
  .then(r => fetch('/report?key=${key}&data=' + encodeURIComponent(JSON.stringify({ external: r }))));</script>`);
      return;
    }
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

    // A proxy profile the owner set to Manual: plain Chrome, traffic through the (authenticated) proxy.
    const { Server } = await import('proxy-chain');
    let proxied = 0;
    const proxy = new Server({ host: '127.0.0.1', port: 0, prepareRequestFunction: request => {
      const allowed = request.username === 'probe-user' && request.password === 'probe-pass';
      if (allowed) proxied++;
      return { requestAuthentication: !allowed };
    } });
    await proxy.listen();
    try {
      const D = await api('POST', '/profiles', { name: 'manual proxy D', advancedSettings: { runtime: 'stable-chrome', proxyLaunch: 'manual' },
        proxy: { type: 'http', host: '127.0.0.1', port: proxy.port, username: 'probe-user', password: 'probe-pass' } });
      assert.equal(D.chromeLaunchMode?.mode, 'manual', 'the editor predicts manual');
      const d1 = await visit(D.id, 'd-check', 'check');
      results.manualProxy = d1.report?.webdriver ?? 'no-report';
      assert.ok(d1.report, 'manual proxy profile page reported');
      assert.equal(d1.launched.cdp, undefined, 'no automation endpoint');
      for (const flag of ['--remote-debugging-pipe', '--remote-debugging-port', '--enable-automation', '--disable-blink-features']) {
        assert.equal(d1.args.some(arg => String(arg).startsWith(flag)), false, `manual proxy launch has no ${flag}`);
      }
      assert.ok(d1.args.some(arg => String(arg).startsWith('--proxy-server=')), 'traffic is sent to the proxy');
      assert.ok(d1.args.some(arg => String(arg).startsWith('--host-resolver-rules=')), 'DNS leak protection stays on');
      assert.ok(proxied > 0, 'the page was loaded through the authenticated proxy');
      assert.equal(d1.report.webdriver, 'false', 'navigator.webdriver in a manual proxy profile');
      await api('POST', `/profiles/${D.id}/stop`);
    } finally {
      await proxy.close(true);
    }

    // 30 Stop/restart cycles of a manual profile: each Stop is AZWAH's graceful close (not a forced kill,
    // not "exit not seen"), Chrome writes its clean-exit marker, and the last cookie and localStorage
    // write before Stop survives into the next run.
    const { lifecycleReport } = await import('../server/browsers.js');
    const E = await api('POST', '/profiles', { name: 'cycle E', advancedSettings: { runtime: 'stable-chrome' } });
    const cycles = [];
    for (let n = 1; n <= 30; n++) {
      await api('POST', `/profiles/${E.id}/launch`, { headless: false, url: `${origin}/e-cycle-${n}?op=cycle&n=${n}` });
      const report = await waitFor(`e-cycle-${n}`);
      assert.ok(report, `cycle ${n} page reported`);
      assert.equal(report.webdriver, 'false', `cycle ${n} webdriver`);
      if (n > 1) assert.deepEqual(report.prev, { cookie: String(n - 1), local: String(n - 1) }, `cycle ${n} sees the cycle ${n - 1} cookie and localStorage`);
      await api('POST', `/profiles/${E.id}/stop`);
      const exit = lifecycleReport().events.filter(e => e.kind === 'browser-exit' && e.id === E.id).at(-1);
      cycles.push([exit.terminationKind, exit.stopEscalation, exit.exitEventSeen, exit.exitType, exit.chosen].join('/'));
      assert.equal(exit.terminationKind, 'RequestedStop', `cycle ${n} stop kind ${JSON.stringify(exit)}`);
      assert.equal(exit.exitEventSeen, true, `cycle ${n} exit event observed`);
      assert.equal(exit.exitType, 'Normal', `cycle ${n} Chrome wrote its clean-exit marker`);
      assert.equal(exit.chosen, 'stopped');
    }
    results.stopCycles = { count: cycles.length, kinds: [...new Set(cycles)] };

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
  // The DNS-leak guard on proxy profiles: does this Chrome apply the exact switch AZWAH passes, the one its
  // "unsupported command-line flag" bar names? A real public hostname must fail to resolve with it.
  const { stableProxyNetworkArgs } = await import('../server/browser-runtime/chrome-stable.js');
  const rules = stableProxyNetworkArgs('proxy.example', true).find(a => a.startsWith('--host-resolver-rules='));
  const dnsProbe = async (key, extra) => {
    const child = spawn(stable.path, ['--no-first-run', '--no-default-browser-check', `--user-data-dir=${temp()}`, ...extra, `${origin}/${key}?op=dns`], { stdio: 'ignore', windowsHide: false });
    try { return (await waitFor(key))?.external ?? 'no-report'; } finally { child.kill(); await new Promise(r => setTimeout(r, 1500)); }
  };
  results.dnsRules = { flag: rules, withRules: await dnsProbe('dns-with', [rules]), without: await dnsProbe('dns-without', []) };
  await direct('plain', []);
  await direct('pipeonly', ['--remote-debugging-pipe'], ['ignore', 'ignore', 'ignore', 'pipe', 'pipe']);
  site.close();
  console.log('WEBDRIVER_SIGNAL ' + JSON.stringify({ chrome: stable.version, results }));
  assert.equal(results.plain, 'false', 'reference: chrome.exe started like a person starts it');
  assert.equal(results.dnsRules.without, 'resolved', 'control: the runner can resolve example.com');
  assert.equal(results.dnsRules.withRules, 'blocked', 'Chrome applies AZWAH\'s host-resolver rule: no local DNS lookups');
});
