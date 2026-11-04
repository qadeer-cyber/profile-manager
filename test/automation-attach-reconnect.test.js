import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import puppeteer from 'puppeteer-core';
import { startLocalHttpFixture } from './_local-http-fixture.mjs';
import { spawnServer, stopServer } from './_ports.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-attach-reconnect-'));
const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'attach-reconnect' };
delete env.PM_SECRET;
let proc;

after(async () => {
  if (proc) await stopServer(proc);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('Playwright and Puppeteer can take turns on one running profile', { timeout: 120000 }, async t => {
  const fixture = await startLocalHttpFixture();
  t.after(() => fixture.close());
  proc = await spawnServer(env);
  const auth = { Authorization: 'Bearer attach-reconnect', 'Content-Type': 'application/json' };
  const created = await fetch(`${proc.url}/api/v1/profiles`, {
    method: 'POST', headers: auth, body: JSON.stringify({ name: 'Attach reconnect', automationEnabled: true }),
  });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const launched = await fetch(`${proc.url}/api/v1/profiles/${id}/launch`, {
    method: 'POST', headers: auth, body: JSON.stringify({ headless: true, automation: true, url: fixture.origin }),
  });
  const launchText = await launched.text();
  assert.equal(launched.status, 200, launchText);
  const launchBody = JSON.parse(launchText);
  const described = await fetch(`${proc.url}/api/v1/profiles/${id}/automation-attach`, { headers: auth });
  assert.equal(described.status, 200);
  const descriptor = await described.json();
  assert.equal(descriptor.attachable, true);
  assert.equal(descriptor.playwright.endpoint, launchBody.cdp.httpEndpoint);
  assert.equal(descriptor.puppeteer.disconnectClosesBrowser, false);
  assert.equal(descriptor.firefox.cdpAttach, false);

  const first = await chromium.connectOverCDP(descriptor.playwright.endpoint);
  assert.match(await first.contexts()[0].pages()[0].title(), /pm-fixture/i);
  await first.close();

  const middle = await puppeteer.connect({ browserURL: descriptor.puppeteer.browserURL, defaultViewport: null });
  const pages = await middle.pages();
  assert.match(await pages[0].title(), /pm-fixture/i);
  await middle.disconnect();

  const second = await chromium.connectOverCDP(descriptor.playwright.endpoint);
  assert.match(await second.contexts()[0].pages()[0].title(), /pm-fixture/i);
  await second.close();

  const status = await fetch(`${proc.url}/api/v1/profiles/${id}/launch-status`, { headers: auth });
  assert.equal(status.status, 200);
  const stopped = await fetch(`${proc.url}/api/v1/profiles/${id}/stop`, { method: 'POST', headers: auth, body: '{}' });
  assert.equal(stopped.status, 200);
});
