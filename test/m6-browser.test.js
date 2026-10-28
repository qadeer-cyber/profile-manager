// Real Chromium checks for user agent, geolocation, window size, and observed hardware.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
import { MANIFEST } from '../server/chromium.js';
import { spawnServer, stopServer } from './_ports.mjs';

test('Chromium applies coherent identity, geolocation, window settings, and observed hardware', { timeout: 180000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m6-browser-'));
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>m6</title>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const pageUrl = `http://127.0.0.1:${server.address().port}/`;
  const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm6-browser' };
  let proc;
  let ui;
  const connections = [];
  const api = async (method, url, body) => {
    const response = await fetch(proc.url + '/api/v1' + url, { method, headers: { Authorization: 'Bearer m6-browser', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json();
    assert.equal(response.ok, true, JSON.stringify(value));
    return value;
  };
  const version = MANIFEST.browserVersion;
  async function observe(id, url = pageUrl) {
    const launched = await api('POST', `/profiles/${id}/launch`, { headless: true, automation: true, url });
    const browser = await chromium.connectOverCDP(launched.cdp.httpEndpoint);
    connections.push(browser);
    const page = browser.contexts()[0].pages().find(item => item.url().startsWith(pageUrl)) || browser.contexts()[0].pages()[0];
    if (!page.url().startsWith(pageUrl)) await page.goto(pageUrl);
    return page;
  }
  try {
    proc = await spawnServer(env);
    const identity = await api('GET', '/chromium-identity');
    assert.equal(identity.version, version);
    const profile = await api('POST', '/profiles', { name: 'M6' });
    let page = await observe(profile.id);
    const natural = await page.evaluate(async () => {
      const data = navigator.userAgentData;
      const high = data ? await data.getHighEntropyValues(['fullVersionList', 'uaFullVersion']) : null;
      return { ua: navigator.userAgent, full: high && high.uaFullVersion, chromium: high && high.fullVersionList.find(item => item.brand === 'Chromium')?.version };
    });
    assert.match(natural.ua, new RegExp(version.replace(/\./g, '\\.')));
    assert.equal(natural.chromium, version);
    assert.equal(natural.full, version);
    await api('POST', `/profiles/${profile.id}/stop`, {});
    await api('PATCH', `/profiles/${profile.id}`, { advancedSettings: { userAgent: { mode: 'reduced' } } });
    page = await observe(profile.id);
    const reduced = await page.evaluate(async () => {
      const high = await navigator.userAgentData.getHighEntropyValues(['uaFullVersion']);
      return { ua: navigator.userAgent, full: high.uaFullVersion };
    });
    assert.match(reduced.ua, /HeadlessChrome\/\d+\.0\.0\.0/);
    assert.equal(reduced.ua.includes(version), false);
    assert.equal(reduced.full, version);
    await api('POST', `/profiles/${profile.id}/stop`, {});
    const configured = await api('PATCH', `/profiles/${profile.id}`, { advancedSettings: {
      userAgent: { mode: 'default' },
      geolocation: { permission: 'allow', latitude: 37.7, longitude: -122.4, accuracy: 20 },
      screen: { preset: 'custom', width: 1280, height: 800, viewportWidth: 1280, viewportHeight: 800, deviceScaleFactor: 2 },
      preferences: { startupUrls: ['https://example.com/startup'], permissions: { notifications: 'deny' } },
    } });
    assert.equal(configured.advancedSettings.screen.deviceScaleFactor, 2);
    page = await observe(profile.id, pageUrl);
    const applied = await page.evaluate(async () => {
      const geo = await new Promise(resolve => navigator.geolocation.getCurrentPosition(pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy }), error => resolve({ code: error.code }), { timeout: 4000 }));
      const notifications = (await navigator.permissions.query({ name: 'notifications' })).state;
      return { geo, notifications, width: innerWidth, height: innerHeight, scale: devicePixelRatio };
    });
    assert.deepEqual(applied.geo, { lat: 37.7, lon: -122.4, acc: 20 });
    assert.equal(applied.notifications, 'denied');
    assert.equal(applied.width, 1280);
    assert.equal(applied.height, 800);
    assert.equal(applied.scale, 2);
    const hardware = await (await fetch(proc.url + `/api/v1/profiles/${profile.id}/hardware`, { headers: { Authorization: 'Bearer m6-browser' } })).json();
    assert.equal(hardware.browser.availability, 'observed');
    assert.equal(hardware.browser.hardwareConcurrency.availability, 'observed');
    assert.equal(typeof hardware.browser.hardwareConcurrency.value, 'number');
    assert.ok(hardware.unsupported.some(item => item.fact === 'fonts' && item.availability === 'unsupported'));
    assert.equal(JSON.stringify(hardware).includes('"simulated"'), false);
    await api('POST', `/profiles/${profile.id}/stop`, {});
    assert.equal(await stopServer(proc), true);
    proc = await spawnServer(env);
    assert.equal((await api('GET', `/profiles/${profile.id}`)).advancedSettings.screen.viewportWidth, 1280);
    page = await observe(profile.id);
    assert.equal(await page.evaluate(() => innerWidth), 1280);
    const explicit = page.url();
    assert.equal(explicit.startsWith(pageUrl), true);
    assert.equal(explicit.includes('example.com'), false);
    await api('POST', `/profiles/${profile.id}/stop`, {});
    if (fs.existsSync(path.join('web', 'dist', 'index.html'))) {
      ui = await chromium.launch({ headless: true });
      const editor = await ui.newPage();
      await editor.goto(proc.url);
      await editor.getByRole('button', { name: 'New profile' }).click();
      await editor.getByLabel('Name', { exact: true }).fill('UI advanced');
      await editor.getByRole('tab', { name: 'Identity' }).click();
      await editor.getByText(version).waitFor();
      await editor.getByRole('tab', { name: 'Window' }).click();
      await editor.getByLabel('Screen preset').selectOption('1280x800');
      await editor.getByRole('tab', { name: 'Location' }).click();
      await editor.getByLabel('Geolocation').selectOption('allow');
      await editor.getByLabel('Latitude').fill('37.7');
      await editor.getByLabel('Longitude').fill('-122.4');
      await editor.getByRole('button', { name: 'Create profile', exact: true }).click();
      await editor.getByRole('cell', { name: 'UI advanced', exact: true }).waitFor();
      await editor.reload();
      await editor.getByRole('button', { name: 'Edit UI advanced', exact: true }).click();
      await editor.getByRole('tab', { name: 'Window' }).click();
      assert.equal(await editor.getByLabel('Screen preset').inputValue(), '1280x800');
      const saved = (await api('GET', '/profiles')).find(item => item.name === 'UI advanced');
      assert.equal(saved.advancedSettings.screen.preset, '1280x800');
      assert.equal(saved.advancedSettings.geolocation.permission, 'allow');
      assert.equal(saved.advancedSettings.geolocation.latitude, 37.7);
    }
  } finally {
    await ui?.close();
    for (const browser of connections) await browser.close().catch(() => {});
    if (proc) await stopServer(proc);
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
