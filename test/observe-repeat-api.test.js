// A running profile must stay observable on every Verify, including after the user browsed in it and
// saved a setting. The probe's cleanup used to wait on Chrome's keep-alive connection to the probe
// server (server.close()) past the 35 s deadline, so the already-collected facts were discarded and
// the whole report said "unavailable" (seen on Windows CI at 7b1eafc and reproduced here).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-observe-repeat-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'observe-repeat';
const { startServer } = await import('../server/app.js');
const { liveContext } = await import('../server/browsers.js');
const server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' });
const site = http.createServer((req, res) => res.writeHead(req.url === '/a' ? 200 : 404, { 'Content-Type': 'text/html' }).end('<title>a</title>'));
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
after(async () => { await server.close(); site.close(); try { (await import('../server/db.js')).db.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); });

const api = async (method, route, body) => {
  const r = await fetch(server.url + '/api/v1' + route, { method, body: body && JSON.stringify(body), signal: AbortSignal.timeout(90000),
    headers: { Authorization: 'Bearer observe-repeat', 'Content-Type': 'application/json' } });
  return r.json();
};

test('repeated Verify on a running profile stays observed and grades a stale setting as warning', { timeout: 180000 }, async () => {
  const p = await api('POST', '/profiles', { name: 'Repeat', browserSettings: { locale: 'de-DE', languages: ['de-DE', 'en-US'], timezoneId: 'Asia/Tokyo' },
    advancedSettings: { fingerprint: { webgl: 'restricted', fonts: 'restricted', mediaDevices: 'restricted' } } });
  const launched = await api('POST', `/profiles/${p.id}/launch`, { headless: true });
  assert.equal(launched.error, undefined, JSON.stringify(launched));
  try {
    const timed = async () => { const t = Date.now(); const rep = await api('GET', `/profiles/${p.id}/hardware`); return { rep, ms: Date.now() - t }; };
    const first = await timed();
    assert.equal(first.rep.browser.availability, 'observed', `first: ${first.rep.browser.reason} at ${first.rep.browser.stage}`);
    await (await liveContext(p.id).newPage()).goto(`http://127.0.0.1:${site.address().port}/a`);
    await api('PUT', `/profiles/${p.id}`, { browserSettings: { locale: 'de-DE', languages: ['de-DE', 'en-US'], timezoneId: 'Europe/Berlin' } });
    const second = await timed();
    assert.equal(second.rep.browser.availability, 'observed', `second: ${second.rep.browser.reason} at ${second.rep.browser.stage}`);
    assert.equal(second.rep.browser.timezone, 'Asia/Tokyo', 'the running browser still has the launch-time zone');
    assert.equal(second.rep.consistency.byCategory.find(c => c.id === 'timezone').status, 'warning', 'saved-but-not-applied zone is a warning');
    assert.ok(first.ms < 30000 && second.ms < 30000, `observations took ${first.ms} and ${second.ms} ms`);
  } finally { await api('POST', `/profiles/${p.id}/stop`); }
});

test('port-scan protection verifies as pass on every launch of the same profile', { timeout: 240000 }, async () => {
  const p = await api('POST', '/profiles', { name: 'Port scan relaunch' });
  for (const run of [1, 2, 3]) {
    const launched = await api('POST', `/profiles/${p.id}/launch`, { headless: true });
    assert.equal(launched.error, undefined, JSON.stringify(launched));
    try {
      const rep = await api('GET', `/profiles/${p.id}/hardware`);
      assert.equal(rep.browser.availability, 'observed', `run ${run}: ${rep.browser.reason} at ${rep.browser.stage}`);
      const states = ['local-network-access', 'local-network', 'loopback-network'].map(n => rep.browser.permissions?.[n]?.state);
      const portScan = rep.consistency.byCategory.find(c => c.id === 'portScan');
      assert.equal(portScan.status, 'pass', `run ${run}: ${JSON.stringify(states)} ${JSON.stringify(portScan.findings)}`);
    } finally { await api('POST', `/profiles/${p.id}/stop`); }
  }
});
