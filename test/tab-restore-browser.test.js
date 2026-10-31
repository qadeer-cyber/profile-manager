// Real Chromium CDP evidence for tab restore (not plan-only). Matrix M1 tab restore is
// VERIFIED only when these tests pass on a host with Playwright Chromium available.
// Opt-in tab restore against the real Chromium build. Default stays off.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
import { closeLastPage } from '../electron/smoke-phases.js';
import { spawnServer, stopServer } from './_ports.mjs';
import { TAB_STATE_NAME } from '../server/tab-restore.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-tab-restore-'));
const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'tab-restore', PM_HEALTH_INTERVAL: '500' };
delete env.PM_SECRET;
let proc;

const api = async (method, url, body) => {
  const response = await fetch(proc.url + '/api/v1' + url, {
    method,
    headers: { Authorization: 'Bearer tab-restore', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let value = null;
  try { value = text ? JSON.parse(text) : null; } catch { value = { raw: text }; }
  return { status: response.status, value };
};

before(async () => { proc = await spawnServer(env); });
after(async () => {
  if (proc) await stopServer(proc);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function makeProfile(name, restoreTabs) {
  const created = await api('POST', '/profiles', {
    name,
    automationEnabled: true,
    advancedSettings: { preferences: { restoreTabs, startupUrls: [] } },
  });
  assert.equal(created.status, 201, JSON.stringify(created.value));
  assert.equal(created.value.advancedSettings.preferences.restoreTabs, restoreTabs);
  return created.value;
}

async function launch(id, body = {}) {
  const result = await api('POST', `/profiles/${id}/launch`, { headless: true, automation: true, ...body });
  assert.equal(result.status, 200, JSON.stringify(result.value));
  return result.value;
}

async function stop(id) {
  const result = await api('POST', `/profiles/${id}/stop`, {});
  assert.equal(result.status, 200, JSON.stringify(result.value));
}

function tabFile(id) {
  return path.join(dir, 'profiles', id, TAB_STATE_NAME);
}

async function withBrowser(launched, fn) {
  const browser = await chromium.connectOverCDP(launched.cdp.httpEndpoint);
  try { return await fn(browser.contexts()[0]); }
  finally { await browser.close().catch(() => {}); }
}

async function openTabs(launched, urls) {
  await withBrowser(launched, async context => {
    const first = context.pages()[0] || await context.newPage();
    await first.goto(urls[0], { waitUntil: 'domcontentloaded', timeout: 20000 });
    for (const url of urls.slice(1)) {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    }
  });
}

function httpUrls(context) {
  return context.pages().map(page => page.url()).filter(url => url.startsWith('http'));
}

async function assertExampleDomainPages(context, expectedCount) {
  const pages = context.pages().filter(page => page.url().startsWith('http'));
  assert.equal(pages.length, expectedCount, `expected ${expectedCount} http tabs, got ${pages.length}`);
  for (const page of pages) {
    await page.waitForFunction(() => document.title && document.title.length > 0, { timeout: 20000 });
    const title = await page.title();
    assert.match(title, /Example Domain/i, `unexpected title "${title}" for ${page.url()}`);
  }
}

test('default off does not save or reopen tabs', { timeout: 120000 }, async () => {
  const profile = await makeProfile('off', false);
  const first = await launch(profile.id);
  await openTabs(first, ['https://example.com/', 'https://example.org/']);
  await stop(profile.id);
  assert.equal(fs.existsSync(tabFile(profile.id)), false);
  const second = await launch(profile.id);
  await withBrowser(second, async context => {
    assert.equal(httpUrls(context).some(url => url.includes('example.com') || url.includes('example.org')), false);
  });
  await stop(profile.id);
});

test('opt-in restore reopens multiple tabs after stop and keeps profiles apart', { timeout: 180000 }, async () => {
  const a = await makeProfile('A', true);
  const b = await makeProfile('B', true);
  const first = await launch(a.id);
  await openTabs(first, ['https://example.com/', 'https://example.org/']);
  await stop(a.id);
  const saved = JSON.parse(fs.readFileSync(tabFile(a.id), 'utf8'));
  assert.deepEqual(saved.urls, ['https://example.com/', 'https://example.org/']);
  assert.equal(fs.existsSync(tabFile(b.id)), false);
  const other = await launch(b.id);
  await withBrowser(other, async context => {
    assert.equal(httpUrls(context).length, 0);
  });
  await stop(b.id);
  const again = await launch(a.id);
  await withBrowser(again, async context => {
    const urls = httpUrls(context).sort();
    assert.deepEqual(urls, ['https://example.com/', 'https://example.org/']);
    await assertExampleDomainPages(context, 2);
  });
  await stop(a.id);
});

test('startup URLs and an explicit launch URL are not combined with saved tabs', { timeout: 180000 }, async () => {
  const profile = await makeProfile('priority', true);
  const first = await launch(profile.id);
  await openTabs(first, ['https://example.com/']);
  await stop(profile.id);
  assert.equal(JSON.parse(fs.readFileSync(tabFile(profile.id), 'utf8')).urls[0], 'https://example.com/');
  await api('PATCH', `/profiles/${profile.id}`, { advancedSettings: { preferences: { restoreTabs: true, startupUrls: ['https://example.org/'] } } });
  const startup = await launch(profile.id);
  await withBrowser(startup, async context => {
    const urls = httpUrls(context);
    assert.deepEqual(urls, ['https://example.org/']);
  });
  await stop(profile.id);
  const explicit = await launch(profile.id, { url: 'https://example.com/' });
  await withBrowser(explicit, async context => {
    assert.deepEqual(httpUrls(context), ['https://example.com/']);
  });
  await stop(profile.id);
});

test('last-window close saves tabs and a corrupt file does not block launch', { timeout: 180000 }, async () => {
  const profile = await makeProfile('window', true);
  // Headless mode does not exit when its last page target closes. A visible
  // window does, which is the M1 last-window path.
  const first = await launch(profile.id, { headless: false });
  await openTabs(first, ['https://example.com/', 'https://example.org/']);
  // page.close() leaves the browser running. The last page target has to be closed
  // with Target.closeTarget, which is the same path as a last-window close.
  assert.ok(String(first.cdp?.debuggerAddress || '').startsWith('127.0.0.1:'), 'CDP is loopback');
  await closeLastPage(first.cdp.wsEndpoint);
  for (let i = 0; i < 80; i++) {
    const current = await api('GET', `/profiles/${profile.id}`);
    if (current.value.running === false && current.value.last_error == null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const afterClose = await api('GET', `/profiles/${profile.id}`);
  assert.equal(afterClose.value.running, false);
  assert.equal(afterClose.value.last_error, null);
  const saved = JSON.parse(fs.readFileSync(tabFile(profile.id), 'utf8'));
  assert.deepEqual(saved.urls, ['https://example.com/', 'https://example.org/']);
  fs.writeFileSync(tabFile(profile.id), '{');
  const launched = await launch(profile.id);
  assert.equal(launched.running, true);
  await stop(profile.id);
  assert.equal(JSON.parse(fs.readFileSync(tabFile(profile.id), 'utf8')).version, 1);
});
