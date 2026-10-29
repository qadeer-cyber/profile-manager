// Real Chromium checks for fingerprint controls. Linux SwiftShader is not a Windows GPU result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
import { MANIFEST } from '../server/chromium.js';
import { spawnServer, stopServer } from './_ports.mjs';

test('Chromium applies real fingerprint restrictions and keeps profile storage isolated', { timeout: 180000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m10-browser-'));
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>m10</title>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const pageUrl = `http://127.0.0.1:${server.address().port}/`;
  const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm10-browser' };
  let proc;
  let ui;
  const connections = [];
  const api = async (method, url, body, { ok = true } = {}) => {
    const response = await fetch(proc.url + '/api/v1' + url, { method, headers: { Authorization: 'Bearer m10-browser', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json();
    if (ok) assert.equal(response.ok, true, JSON.stringify(value));
    return { status: response.status, value };
  };
  const finding = (report, id) => report.findings.find(item => item.id === id);
  async function openPage(id) {
    const launched = await api('POST', `/profiles/${id}/launch`, { headless: true, automation: true, url: pageUrl });
    const browser = await chromium.connectOverCDP(launched.value.cdp.httpEndpoint);
    connections.push(browser);
    const page = browser.contexts()[0].pages().find(item => item.url().startsWith(pageUrl)) || browser.contexts()[0].pages()[0];
    if (!page.url().startsWith(pageUrl)) await page.goto(pageUrl);
    return { launched, page };
  }
  try {
    proc = await spawnServer(env);
    const version = MANIFEST.browserVersion;
    const rejected = await api('POST', '/profiles', { name: 'Rejected', advancedSettings: { fingerprint: { canvas: 'noise' } } }, { ok: false });
    assert.equal(rejected.status, 400);
    assert.match(rejected.value.error, /Canvas noise/);
    assert.equal((await api('GET', '/profiles')).value.find(item => item.name === 'Rejected'), undefined);

    const profile = (await api('POST', '/profiles', {
      name: 'Fingerprint',
      browserSettings: { locale: 'en-US', timezoneId: 'UTC', languages: ['en-US'] },
      advancedSettings: {
        userAgent: { mode: 'reduced' },
        screen: { preset: '1280x800', deviceScaleFactor: 2 },
        geolocation: { permission: 'allow', latitude: 37.7, longitude: -122.4, accuracy: 20 },
      },
    })).value;
    assert.equal(profile.advancedSettings.fingerprint.webgl, 'default');
    assert.equal(profile.advancedSettings.fingerprint.canvas, 'real');
    let { page } = await openPage(profile.id);
    const natural = await page.evaluate(async () => {
      const high = await navigator.userAgentData.getHighEntropyValues(['uaFullVersion', 'fullVersionList']);
      return { ua: navigator.userAgent, full: high.uaFullVersion, chromium: high.fullVersionList.find(item => item.brand === 'Chromium')?.version };
    });
    assert.match(natural.ua, /HeadlessChrome\/\d+\.0\.0\.0/);
    assert.equal(natural.ua.includes(version), false);
    assert.equal(natural.full, version);
    assert.equal(natural.chromium, version);
    const placed = await page.evaluate(async () => {
      const geo = await new Promise(resolve => navigator.geolocation.getCurrentPosition(pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy }), () => resolve(null), { timeout: 4000 }));
      return { geo, width: innerWidth, height: innerHeight, scale: devicePixelRatio };
    });
    assert.deepEqual(placed.geo, { lat: 37.7, lon: -122.4, acc: 20 });
    assert.equal(placed.width, 1280);
    assert.equal(placed.height, 800);
    assert.equal(placed.scale, 2);
    await page.evaluate(() => { localStorage.setItem('pm-iso', 'alpha'); document.cookie = 'pmiso=alpha; path=/; max-age=86400'; });
    const first = await api('GET', `/profiles/${profile.id}/hardware`);
    assert.equal(first.value.browser.availability, 'observed');
    assert.equal(first.value.browser.canvas.availability, 'observed');
    assert.equal(first.value.browser.audio.availability, 'observed');
    assert.equal(first.value.browser.webgl.availability, 'observed');
    assert.equal(JSON.stringify(first.value).includes('"simulated"'), false);
    const consistency = first.value.consistency;
    assert.equal(finding(consistency, 'ua_version').status, 'pass');
    assert.equal(finding(consistency, 'timezone').status, 'pass');
    assert.equal(finding(consistency, 'languages').status, 'pass');
    assert.equal(finding(consistency, 'locale').status, 'pass');
    assert.equal(finding(consistency, 'host_platform').status, 'pass');
    assert.equal(finding(consistency, 'port_scan_policy').status, 'pass');
    assert.match(finding(consistency, 'port_scan_policy').summary, /not proof/);
    assert.equal(finding(consistency, 'screen').status, 'pass');
    assert.equal(finding(consistency, 'geolocation').status, 'pass');
    assert.equal(finding(consistency, 'canvas_noise').status, 'unsupported');
    assert.equal(finding(consistency, 'canvas_readback').status, 'pass');
    assert.equal(finding(consistency, 'webgl_metadata').status, 'unsupported');
    assert.equal(finding(consistency, 'webgl_restriction').status, 'unavailable');
    assert.equal(finding(consistency, 'port_scan_mask').status, 'unsupported');
    assert.equal(finding(consistency, 'webrtc_ice').status, 'unavailable');
    const canvasHash = first.value.browser.canvas.sha256;
    const audioHash = first.value.browser.audio.sha256;
    const renderer = first.value.browser.webgl.renderer;
    assert.ok(renderer && !/Intel/.test(renderer), 'this Linux host is not the Latitude 5480 GPU');
    await api('POST', `/profiles/${profile.id}/stop`);

    const other = (await api('POST', '/profiles', { name: 'Other' })).value;
    ({ page } = await openPage(other.id));
    const leaked = await page.evaluate(() => ({ storage: localStorage.getItem('pm-iso'), cookie: document.cookie }));
    assert.equal(leaked.storage, null);
    assert.equal(leaked.cookie.includes('pmiso=alpha'), false);
    await page.evaluate(() => localStorage.setItem('pm-iso', 'bravo'));
    await api('POST', `/profiles/${other.id}/stop`);
    ({ page } = await openPage(profile.id));
    assert.equal(await page.evaluate(() => localStorage.getItem('pm-iso')), 'alpha');
    assert.match(await page.evaluate(() => document.cookie), /pmiso=alpha/);
    await api('POST', `/profiles/${profile.id}/stop`);
    ({ page } = await openPage(other.id));
    assert.equal(await page.evaluate(() => localStorage.getItem('pm-iso')), 'bravo');
    await api('POST', `/profiles/${other.id}/stop`);

    const restricted = await api('PATCH', `/profiles/${profile.id}`, { advancedSettings: { fingerprint: { webgl: 'restricted', fonts: 'restricted', mediaDevices: 'restricted' } } });
    assert.equal(restricted.value.advancedSettings.fingerprint.webgl, 'restricted');
    ({ page } = await openPage(profile.id));
    const disabled = await page.evaluate(async () => {
      const gl = document.createElement('canvas').getContext('webgl');
      const permissions = {};
      for (const name of ['local-fonts', 'camera', 'microphone']) permissions[name] = (await navigator.permissions.query({ name })).state;
      return { webgl: !!gl, permissions };
    });
    assert.equal(disabled.webgl, false);
    assert.equal(disabled.permissions['local-fonts'], 'denied');
    assert.equal(disabled.permissions.camera, 'denied');
    assert.equal(disabled.permissions.microphone, 'denied');
    const second = await api('POST', `/profiles/${profile.id}/fingerprint-consistency`, {
      previous: { canvasSha256: canvasHash, audioSha256: audioHash, webglRenderer: renderer },
    });
    assert.equal(finding(second.value, 'webgl_restriction').status, 'pass', finding(second.value, 'webgl_restriction').summary);
    assert.equal(finding(second.value, 'fonts_permission').status, 'pass');
    assert.equal(finding(second.value, 'media_permission').status, 'pass');
    assert.equal(finding(second.value, 'fonts_mask').status, 'unsupported');
    assert.equal(finding(second.value, 'media_mask').status, 'unsupported');
    assert.equal(finding(second.value, 'restart_canvas').status, 'pass');
    assert.equal(finding(second.value, 'restart_audio').status, 'pass');
    assert.equal(finding(second.value, 'webgpu_metadata').status, 'unsupported');
    const applied = second.value.findings.filter(item => item.status === 'pass').map(item => item.id);
    assert.equal(applied.includes('webgl_metadata'), false);
    assert.equal(applied.includes('canvas_noise'), false);
    assert.equal(applied.includes('port_scan_mask'), false);
    await api('POST', `/profiles/${profile.id}/stop`);

    assert.equal(await stopServer(proc), true);
    proc = await spawnServer(env);
    const reloaded = await api('GET', `/profiles/${profile.id}`);
    assert.equal(reloaded.value.advancedSettings.fingerprint.webgl, 'restricted');
    assert.equal(reloaded.value.advancedSettings.fingerprint.fonts, 'restricted');
    assert.equal(reloaded.value.browserSettings.timezoneId, 'UTC');
    ({ page } = await openPage(profile.id));
    assert.equal(await page.evaluate(() => document.createElement('canvas').getContext('webgl')), null);
    assert.equal(await page.evaluate(() => localStorage.getItem('pm-iso')), 'alpha');
    await api('POST', `/profiles/${profile.id}/stop`);

    if (fs.existsSync(path.join('web', 'dist', 'index.html'))) {
      ui = await chromium.launch({ headless: true });
      const editor = await ui.newPage();
      await editor.goto(proc.url);
      await editor.getByRole('button', { name: 'New profile' }).click();
      await editor.getByLabel('Name', { exact: true }).fill('UI fingerprint');
      await editor.getByRole('tab', { name: 'Fingerprint' }).click();
      await editor.getByLabel('WebGL').selectOption('restricted');
      await editor.getByLabel('Local fonts').selectOption('restricted');
      await editor.getByRole('button', { name: 'Create profile', exact: true }).click();
      await editor.getByRole('cell', { name: 'UI fingerprint', exact: true }).waitFor();
      await editor.reload();
      await editor.getByRole('button', { name: 'Edit UI fingerprint', exact: true }).click();
      await editor.getByRole('tab', { name: 'Fingerprint' }).click();
      assert.equal(await editor.getByLabel('WebGL').inputValue(), 'restricted');
      assert.equal(await editor.getByLabel('Local fonts').inputValue(), 'restricted');
      const saved = (await api('GET', '/profiles')).value.find(item => item.name === 'UI fingerprint');
      assert.equal(saved.advancedSettings.fingerprint.webgl, 'restricted');
      assert.equal(saved.advancedSettings.fingerprint.canvas, 'real');
    }
  } finally {
    for (const browser of connections) await browser.close().catch(() => {});
    await ui?.close().catch(() => {});
    if (proc) await stopServer(proc).catch(() => {});
    await new Promise(resolve => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
