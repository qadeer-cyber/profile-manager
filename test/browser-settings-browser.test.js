// Real Chromium acceptance. Missing browser binaries FAIL; no skip or mock fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { migrate, migrations } from '../server/migrations.js';
import { chromium } from 'playwright';
import { spawnServer, stopServer } from './_ports.mjs';

test('real Chromium observes regional settings, isolated profiles, restart/reset and UI persistence', { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m3-browser-'));
  let srv, uiBrowser;
  const connections = [];
  const echo = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<html><body><pre>${JSON.stringify(req.headers['accept-language'] || '')}</pre></body></html>`); });
  await new Promise(r => echo.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${echo.address().port}`;
  const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm3-browser-test' };
  async function api(method, p, body) {
    const r = await fetch(srv.url + '/api/v1' + p, { method, headers: { Authorization: 'Bearer m3-browser-test', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await r.json(); assert.ok(r.ok, JSON.stringify(value)); return value;
  }
  async function observe(id, expected) {
    const p = await api('POST', `/profiles/${id}/launch`, { headless: true, automation: true });
    assert.match(p.cdp.httpEndpoint, /^http:\/\/127\.0\.0\.1:/);
    const browser = await chromium.connectOverCDP(p.cdp.httpEndpoint); connections.push(browser);
    const context = browser.contexts()[0];
    for (const page of [context.pages()[0], await context.newPage()]) {
      await page.goto(url);
      const got = await page.evaluate(() => ({ locale: Intl.DateTimeFormat().resolvedOptions().locale, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, language: navigator.language, languages: [...navigator.languages], header: JSON.parse(document.querySelector('pre').textContent) }));
      assert.equal(got.locale, expected.locale); assert.equal(got.tz, expected.timezoneId);
      assert.equal(got.language, expected.languages[0]); assert.deepEqual(got.languages, expected.languages);
      assert.ok(got.header.startsWith(expected.languages[0]));
      for (let i = 1; i < expected.languages.length; i++) {
        assert.ok(got.header.includes(expected.languages[i]));
        assert.ok(got.header.indexOf(expected.languages[i - 1]) < got.header.indexOf(expected.languages[i]));
      }
    }
    return { context };
  }
  try {
    const legacyId = randomUUID();
    const legacyDb = new Database(path.join(dir, 'profiles.db'));
    try {
      migrate(legacyDb, migrations.filter(m => m.version <= 7));
      legacyDb.prepare("INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES (?,'Legacy default','[]','','','t','t')").run(legacyId);
    } finally { legacyDb.close(); }
    srv = await spawnServer(env);
    const a = { locale: 'fr-FR', timezoneId: 'Asia/Karachi', languages: ['fr-FR', 'de-DE'] };
    const b = { locale: 'en-US', timezoneId: 'America/New_York', languages: ['en-US', 'ur-PK'] };
    const localeOnly = await api('POST', '/profiles', { name: 'Locale only', browserSettings: { locale: 'de-DE', timezoneId: 'Europe/Berlin', languages: [] } });
    await observe(localeOnly.id, { locale: 'de-DE', timezoneId: 'Europe/Berlin', languages: ['de-DE'] });
    await api('POST', `/profiles/${localeOnly.id}/stop`, {});
    const languageOnly = await api('POST', '/profiles', { name: 'Language only', browserSettings: { locale: '', timezoneId: 'UTC', languages: ['fr-FR'] } });
    await observe(languageOnly.id, { locale: 'fr-FR', timezoneId: 'UTC', languages: ['fr-FR'] });
    await api('POST', `/profiles/${languageOnly.id}/stop`, {});
    const p = await api('POST', '/profiles', { name: 'Regional A', browserSettings: a });
    const q = await api('POST', '/profiles', { name: 'Regional B', browserSettings: b });
    const active = await observe(p.id, a); await observe(q.id, b);
    assert.equal(await active.context.pages()[0].evaluate(() => Intl.DateTimeFormat().resolvedOptions().locale), a.locale);
    const clone = await api('POST', `/profiles/${p.id}/clone`, { copyData: false });
    assert.deepEqual(clone.browserSettings, a);
    await observe(clone.id, a); await api('POST', `/profiles/${clone.id}/stop`, {});
    const saved = await api('PATCH', `/profiles/${p.id}`, { browserSettings: b });
    assert.equal(saved.appliesOnNextLaunch, true);
    assert.equal(await active.context.pages()[0].evaluate(() => Intl.DateTimeFormat().resolvedOptions().locale), a.locale);
    assert.equal(await active.context.pages()[0].evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), a.timezoneId);
    await api('POST', `/profiles/${p.id}/stop`, {}); await observe(p.id, b);
    await api('POST', `/profiles/${p.id}/stop`, {}); await api('POST', `/profiles/${q.id}/stop`, {});
    assert.equal(await stopServer(srv), true); srv = await spawnServer(env);
    assert.deepEqual((await api('GET', `/profiles/${p.id}`)).browserSettings, b);
    await observe(p.id, b); await api('POST', `/profiles/${p.id}/stop`, {});
    const control = await api('POST', '/profiles', { name: 'Host defaults' });
    const baseline = await api('POST', `/profiles/${control.id}/launch`, { headless: true, automation: true });
    const defaultBrowser = await chromium.connectOverCDP(baseline.cdp.httpEndpoint); connections.push(defaultBrowser);
    const defaultPage = defaultBrowser.contexts()[0].pages()[0];
    const snapshot = () => ({ intl: Intl.DateTimeFormat().resolvedOptions(), language: navigator.language, languages: [...navigator.languages] });
    const host = await defaultPage.evaluate(snapshot);
    const legacy = await api('POST', `/profiles/${legacyId}/launch`, { headless: true, automation: true });
    assert.deepEqual(legacy.browserSettings, { locale: '', timezoneId: '', languages: [] });
    const legacyBrowser = await chromium.connectOverCDP(legacy.cdp.httpEndpoint); connections.push(legacyBrowser);
    assert.deepEqual(await legacyBrowser.contexts()[0].pages()[0].evaluate(snapshot), host);
    await api('POST', `/profiles/${legacyId}/stop`, {});
    await api('POST', `/profiles/${control.id}/stop`, {});
    await api('PATCH', `/profiles/${p.id}`, { browserSettings: { locale: '', timezoneId: '', languages: [] } });
    const defaults = await api('POST', `/profiles/${p.id}/launch`, { headless: true, automation: true });
    assert.ok(defaults.running);
    const resetBrowser = await chromium.connectOverCDP(defaults.cdp.httpEndpoint); connections.push(resetBrowser);
    assert.deepEqual(await resetBrowser.contexts()[0].pages()[0].evaluate(snapshot), host);
    await api('POST', `/profiles/${p.id}/stop`, {});
    uiBrowser = await chromium.launch({ headless: true });
    const page = await uiBrowser.newPage(); await page.goto(srv.url);
    await page.getByRole('button', { name: 'New profile' }).click();
    await page.getByLabel('Name', { exact: true }).fill('UI regional');
    await page.getByRole('tab', { name: 'Region & language' }).click();
    await page.getByLabel('Locale', { exact: true }).fill('en-US');
    await page.getByLabel('Timezone', { exact: true }).fill('Asia/Karachi');
    await page.getByLabel('Preferred languages, in order').fill('en-US, ur-PK');
    await page.getByRole('button', { name: 'Create profile', exact: true }).click();
    await page.getByRole('cell', { name: 'UI regional', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('cell', { name: 'UI regional', exact: true }).waitFor();
    assert.deepEqual((await api('GET', '/profiles')).find(p => p.name === 'UI regional').browserSettings, { ...b, timezoneId: 'Asia/Karachi' });
    await page.getByRole('button', { name: 'Edit UI regional', exact: true }).click();
    await page.getByRole('tab', { name: 'Region & language' }).click();
    assert.equal(await page.getByLabel('Locale', { exact: true }).inputValue(), 'en-US');
    assert.equal(await page.getByLabel('Preferred languages, in order').inputValue(), 'en-US, ur-PK');
    await page.getByLabel('Timezone', { exact: true }).fill('UTC');
    const response = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/api/profiles/'));
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    assert.equal((await response).status(), 200);
    await page.reload();
    assert.equal((await api('GET', '/profiles')).find(p => p.name === 'UI regional').browserSettings.timezoneId, 'UTC');
  } finally {
    await uiBrowser?.close();
    for (const browser of connections) await browser.close().catch(() => {});
    if (srv) await stopServer(srv);
    await new Promise(r => echo.close(r)); fs.rmSync(dir, { recursive: true, force: true });
  }
});
