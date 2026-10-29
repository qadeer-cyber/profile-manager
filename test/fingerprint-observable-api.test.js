import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
import { spawnServer, stopServer } from './_ports.mjs';
import { MANIFEST } from '../server/chromium.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-fp-obs-'));
const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'fp-obs' };
delete env.PM_SECRET;
let proc;

after(async () => {
  if (proc) await stopServer(proc);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('M20–M23 observable facts in live Chromium session match profile settings', { timeout: 120000 }, async () => {
  proc = await spawnServer(env);
  const auth = { Authorization: 'Bearer fp-obs', 'Content-Type': 'application/json' };
  await fetch(`${proc.url}/api/settings`, { method: 'PUT', headers: auth, body: JSON.stringify({ minFreeMemoryGiB: 0, maxRunningProfiles: 4 }) });
  const created = await fetch(`${proc.url}/api/v1/profiles`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      name: 'Locale screen UA',
      automationEnabled: true,
      browserSettings: { locale: 'en-US', timezoneId: 'Europe/Paris', languages: ['en-US', 'fr-FR'] },
      advancedSettings: {
        userAgent: { mode: 'full' },
        screen: { preset: '1280x800', deviceScaleFactor: 1 },
      },
    }),
  });
  assert.equal(created.status, 201);
  const profile = await created.json();
  const launched = await fetch(`${proc.url}/api/v1/profiles/${profile.id}/launch`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ headless: true, automation: true, url: 'https://example.com/' }),
  });
  assert.equal(launched.status, 200);
  const { cdp } = await launched.json();
  const browser = await chromium.connectOverCDP(cdp.httpEndpoint);
  try {
    const page = browser.contexts()[0].pages()[0];
    await page.waitForFunction(() => document.title && document.title.length > 0, { timeout: 20000 });
    const facts = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      locale: navigator.language,
      languages: [...navigator.languages],
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    }));
    assert.match(facts.userAgent, new RegExp(`Chrome/${MANIFEST.browserVersion.replace(/\./g, '\\.')}`));
    assert.equal(facts.locale, 'en-US');
    assert.ok(facts.languages.includes('en-US'));
    assert.equal(facts.timezone, 'Europe/Paris');
    assert.equal(facts.innerWidth, 1280);
    assert.equal(facts.innerHeight, 800);
  } finally {
    await browser.close();
  }
  await fetch(`${proc.url}/api/v1/profiles/${profile.id}/stop`, { method: 'POST', headers: auth, body: '{}' });
});
