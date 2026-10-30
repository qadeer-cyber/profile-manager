// Negative / isolation / persistence checks for stock fingerprint controls (M20–M30 adjacent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
import { spawnServer, stopServer } from './_ports.mjs';
import { withBrowserTestEnv, chromiumAvailableForTests } from './_browser-env.mjs';

test('invalid fingerprint modes are rejected and never persisted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-fp-neg-api-'));
  const proc = await spawnServer(withBrowserTestEnv({ PM_DATA_DIR: dir, PM_API_TOKEN: 'fp-neg' }));
  const auth = { Authorization: 'Bearer fp-neg', 'Content-Type': 'application/json' };
  try {
    for (const advancedSettings of [
      { fingerprint: { canvas: 'noise' } },
      { fingerprint: { portScan: 'masked' } },
      { fingerprint: { webgpu: 'restricted' } },
    ]) {
      const response = await fetch(`${proc.url}/api/v1/profiles`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ name: 'Rejected', advancedSettings }),
      });
      assert.equal(response.status, 400, JSON.stringify(advancedSettings));
    }
    const list = await fetch(`${proc.url}/api/v1/profiles`, { headers: auth }).then(r => r.json());
    assert.equal(list.find(item => item.name === 'Rejected'), undefined);
  } finally {
    await stopServer(proc);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('restricted fingerprint settings persist across server restart and stay isolated per profile', {
  timeout: 180000,
  skip: chromiumAvailableForTests() ? false : 'Chromium not installed for browser tests',
}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-fp-neg-iso-'));
  const env = withBrowserTestEnv({ PM_DATA_DIR: dir, PM_API_TOKEN: 'fp-iso' });
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><title>iso</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const pageUrl = `http://127.0.0.1:${server.address().port}/`;
  let proc = await spawnServer(env);
  const auth = { Authorization: 'Bearer fp-iso', 'Content-Type': 'application/json' };
  const api = async (method, url, body) => {
    const response = await fetch(`${proc.url}/api/v1${url}`, {
      method,
      headers: auth,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = await response.json().catch(() => ({}));
    assert.equal(response.ok, true, JSON.stringify(value));
    return value;
  };
  try {
    await fetch(`${proc.url}/api/settings`, { method: 'PUT', headers: auth, body: JSON.stringify({ minFreeMemoryGiB: 0, maxRunningProfiles: 6 }) });
    const a = (await api('POST', '/profiles', {
      name: 'Iso A',
      advancedSettings: { fingerprint: { webgl: 'restricted', fonts: 'restricted' } },
    })).id;
    const b = (await api('POST', '/profiles', { name: 'Iso B' })).id;

    const launch = async id => {
      const launched = await api('POST', `/profiles/${id}/launch`, { headless: true, automation: true, url: pageUrl });
      const browser = await chromium.connectOverCDP(launched.cdp.httpEndpoint);
      const page = browser.contexts()[0].pages()[0];
      return { browser, page };
    };

    let { browser, page } = await launch(a);
    await page.evaluate(() => localStorage.setItem('pm-fp-iso', 'only-a'));
    await browser.close();
    await api('POST', `/profiles/${a}/stop`, {});

    ({ browser, page } = await launch(b));
    assert.equal(await page.evaluate(() => localStorage.getItem('pm-fp-iso')), null);
    await browser.close();
    await api('POST', `/profiles/${b}/stop`, {});

    assert.equal(await stopServer(proc), true);
    proc = await spawnServer(env);
    const reloaded = await api('GET', `/profiles/${a}`);
    assert.equal(reloaded.advancedSettings.fingerprint.webgl, 'restricted');
    assert.equal(reloaded.advancedSettings.fingerprint.fonts, 'restricted');

    ({ browser, page } = await launch(a));
    const perms = await page.evaluate(async () => {
      const gl = document.createElement('canvas').getContext('webgl');
      const localFonts = (await navigator.permissions.query({ name: 'local-fonts' })).state;
      return { webgl: !!gl, localFonts };
    });
    assert.equal(perms.webgl, false);
    assert.equal(perms.localFonts, 'denied');
    assert.equal(await page.evaluate(() => localStorage.getItem('pm-fp-iso')), 'only-a');
    await browser.close();
    await api('POST', `/profiles/${a}/stop`, {});
  } finally {
    if (proc) await stopServer(proc).catch(() => {});
    await new Promise(resolve => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
