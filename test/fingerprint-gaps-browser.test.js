// Gap-close browser checks: geolocation modes, ICE observation, fingerprint restart, mismatch warnings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
import { spawnServer, stopServer } from './_ports.mjs';

test('geolocation ask and deny, ICE observation, fingerprint restart, and mismatch warnings', { timeout: 240000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m10-gaps-'));
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>gaps</title>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const pageUrl = `http://127.0.0.1:${server.address().port}/`;
  const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm10-gaps' };
  let proc;
  const connections = [];
  const auth = { Authorization: 'Bearer m10-gaps', 'Content-Type': 'application/json' };
  const api = async (method, url, body) => {
    const response = await fetch(proc.url + '/api/v1' + url, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json();
    assert.equal(response.ok, true, JSON.stringify(value));
    return value;
  };
  const finding = (report, id) => report.findings.find(item => item.id === id);
  async function observe(id) {
    const launched = await api('POST', `/profiles/${id}/launch`, { headless: true, automation: true, url: pageUrl });
    const browser = await chromium.connectOverCDP(launched.cdp.httpEndpoint);
    connections.push(browser);
    return launched;
  }
  try {
    proc = await spawnServer(env);
    await fetch(proc.url + '/api/settings', { method: 'PUT', headers: auth, body: JSON.stringify({ minFreeMemoryGiB: 0, maxRunningProfiles: 6 }) });

    const deny = (await api('POST', '/profiles', { name: 'Deny geo', advancedSettings: { geolocation: { permission: 'deny' } } })).id;
    await observe(deny);
    let report = (await api('GET', `/profiles/${deny}/hardware`)).consistency;
    assert.equal(finding(report, 'geolocation').status, 'pass');
    await api('POST', `/profiles/${deny}/stop`);

    const ask = (await api('POST', '/profiles', { name: 'Ask geo', advancedSettings: { geolocation: { permission: 'ask' } } })).id;
    await observe(ask);
    report = (await api('GET', `/profiles/${ask}/hardware`)).consistency;
    assert.equal(finding(report, 'geolocation').status, 'pass');
    await api('POST', `/profiles/${ask}/stop`);

    const iceProfile = (await api('POST', '/profiles', { name: 'ICE', webrtcSettings: { mode: 'disable_non_proxied_udp' } })).id;
    await observe(iceProfile);
    const hardware = await api('GET', `/profiles/${iceProfile}/hardware`);
    assert.equal(hardware.browser.webrtcIce?.availability, 'observed');
    assert.ok(hardware.browser.webrtcIce.candidateCount >= 0);
    report = hardware.consistency;
    assert.equal(finding(report, 'webrtc_proxy_match').status, 'unsupported');
    assert.ok(['pass', 'warning'].includes(finding(report, 'webrtc_ice').status));
    assert.match(finding(report, 'webrtc_ice').summary, /WebRTC matches the proxy|not compared to the proxy/);
    const fingerprintJson = JSON.stringify(hardware.configured.fingerprint);
    await api('POST', `/profiles/${iceProfile}/stop`);
    await observe(iceProfile);
    report = (await api('POST', `/profiles/${iceProfile}/fingerprint-consistency`, { previous: { fingerprintSettings: fingerprintJson } }));
    assert.equal(finding(report, 'restart_fingerprint').status, 'pass');
    report = await api('POST', `/profiles/${iceProfile}/fingerprint-consistency`, {
      previous: { canvasSha256: '0'.repeat(64) },
    });
    const canvasRestart = finding(report, 'restart_canvas');
    assert.equal(canvasRestart.status, 'warning', canvasRestart.summary);
    await api('POST', `/profiles/${iceProfile}/stop`);

    const isoA = (await api('POST', '/profiles', { name: 'Iso A' })).id;
    const isoB = (await api('POST', '/profiles', { name: 'Iso B' })).id;
    await observe(isoA);
    const browser = connections.at(-1);
    const page = browser.contexts()[0].pages()[0];
    await page.evaluate(() => localStorage.setItem('gap-key', 'only-a'));
    await api('POST', `/profiles/${isoA}/stop`);
    await observe(isoB);
    const pageB = connections.at(-1).contexts()[0].pages()[0];
    assert.equal(await pageB.evaluate(() => localStorage.getItem('gap-key')), null);
    await api('POST', `/profiles/${isoB}/stop`);
  } finally {
    for (const browser of connections) await browser.close().catch(() => {});
    if (proc) await stopServer(proc).catch(() => {});
    await new Promise(resolve => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
