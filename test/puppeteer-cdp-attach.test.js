import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import puppeteer from 'puppeteer-core';
import { chromium } from 'playwright';
import { spawnServer, stopServer } from './_ports.mjs';
import { startLocalHttpFixture } from './_local-http-fixture.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-puppeteer-attach-'));
const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'puppeteer-attach' };
delete env.PM_SECRET;
let proc;

after(async () => {
  if (proc) await stopServer(proc);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('puppeteer-core connects over CDP without closing the profile browser', { timeout: 120000 }, async t => {
  const fixture = await startLocalHttpFixture();
  t.after(() => fixture.close());
  proc = await spawnServer(env);
  const auth = { Authorization: 'Bearer puppeteer-attach', 'Content-Type': 'application/json' };
  const created = await fetch(`${proc.url}/api/v1/profiles`, {
    method: 'POST', headers: auth, body: JSON.stringify({ name: 'Puppeteer attach', automationEnabled: true }),
  });
  const { id } = await created.json();
  const launched = await fetch(`${proc.url}/api/v1/profiles/${id}/launch`, {
    method: 'POST', headers: auth, body: JSON.stringify({ headless: true, automation: true, url: fixture.origin }),
  });
  assert.equal(launched.status, 200);
  const { cdp } = await launched.json();
  const exe = chromium.executablePath();
  const browser = await puppeteer.connect({ browserURL: cdp.httpEndpoint, defaultViewport: null });
  t.after(() => browser.disconnect());
  const pages = await browser.pages();
  const title = await pages[0].title();
  assert.match(title, /pm-fixture|ok/i);
  await browser.disconnect();
  const relaunch = await fetch(`${proc.url}/api/v1/profiles/${id}/launch-status`, { headers: auth });
  assert.equal(relaunch.status, 200);
  await fetch(`${proc.url}/api/v1/profiles/${id}/stop`, { method: 'POST', headers: auth });
  await fixture.close();
});
