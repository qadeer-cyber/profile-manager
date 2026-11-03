// Mandatory real-host gates. Missing browsers, window manager or signed fixture
// are failures, never synthetic passes or dynamically introduced skips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { spawnServer, stopServer } from './_ports.mjs';
import { observeNativeWindow, restoreNativeWindow } from '../server/native-window-state.js';
import { readHostDisplays } from '../server/window-placement.js';
import { validateXpiArchive } from '../server/gecko-xpi.js';
import { buildXpi } from './_xpi-fixture.mjs';

async function installation(t, prefix, extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)), token = crypto.randomBytes(24).toString('hex'); let server;
  const start = async () => { const env = { ...process.env, ...extraEnv, PM_DATA_DIR: dir, PM_API_TOKEN: token }; delete env.PM_SECRET; server = await spawnServer(env); };
  const api = async (route, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(server.url + '/api/v1' + route, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
  };
  t.after(async () => { if (server) assert.equal(await stopServer(server), true); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });
  await start();
  return { dir, api, url: () => server.url, restart: async () => { assert.equal(await stopServer(server), true); server = null; await start(); } };
}
async function eventually(read, accept, message) {
  const end = Date.now() + 15000; let value;
  do { value = await read(); if (accept(value)) return value; await new Promise(r => setTimeout(r, 150)); } while (Date.now() < end);
  assert.fail(`${message}: ${JSON.stringify(value)}`);
}
for (const engine of ['chromium','firefox']) test(`M12 real ${engine} OS geometry and maximized state survive stop and application restart`, { timeout: 120000 }, async t => {
  const displays = readHostDisplays();
  assert.ok(displays?.length, 'Real Windows desktop or X11 window manager with monitor information is required');
  const app = await installation(t, 'pm-trackc-window-', { MOZ_HEADLESS: '', HEADLESS: '0' });
  const p = await app.api('/profiles', { name: 'Observed window', browserEngine: engine, advancedSettings: { preferences: { rememberLastWindow: true } } });
  const launch = () => app.api(`/profiles/${p.id}/launch`, { headless: false, automation: true });
  let launched = await launch();
  const display = displays[0], wanted = { left: display.x + 40, top: display.y + 40, width: Math.min(1000, display.width - 80), height: Math.min(700, display.height - 80), maximized: false };
  const matches = s => s && !s.maximized && ['left','top','width','height'].every(k => Math.abs(s[k] - wanted[k]) <= 16);
  await eventually(() => observeNativeWindow(launched.cdp.pid), Boolean, 'Native window never appeared');
  assert.equal(await restoreNativeWindow(launched.cdp.pid, wanted), true);
  await eventually(() => observeNativeWindow(launched.cdp.pid), matches, 'OS did not apply the requested normal bounds');
  await app.api(`/profiles/${p.id}/stop`, {});
  const stateFile = path.join(app.dir, 'profiles', p.id, '.pm-window.json');
  const saved = JSON.parse(fs.readFileSync(stateFile)); assert.ok(matches(saved)); assert.match(saved.source, /^(win32-placement|x11-window-manager)$/);
  await app.restart(); launched = await launch();
  await eventually(() => observeNativeWindow(launched.cdp.pid), matches, 'Normal bounds were not restored after restart');
  assert.equal(await restoreNativeWindow(launched.cdp.pid, { ...wanted, maximized: true }), true);
  await eventually(() => observeNativeWindow(launched.cdp.pid), s => s?.maximized, 'Window did not maximize');
  await app.api(`/profiles/${p.id}/stop`, {}); assert.equal(JSON.parse(fs.readFileSync(stateFile)).maximized, true);
  await app.restart(); launched = await launch();
  await eventually(() => observeNativeWindow(launched.cdp.pid), s => s?.maximized, 'Maximized state was not restored after restart');
  await app.api(`/profiles/${p.id}/stop`, {});
  if (engine === 'firefox') {
    launched = await app.api(`/profiles/${p.id}/launch`, { headless: false, automation: false });
    assert.equal(launched.cdp, undefined); assert.ok(Number.isSafeInteger(launched.pid));
    await eventually(() => observeNativeWindow(launched.pid), s => s?.maximized, 'Manual Firefox launch did not restore its real browser window');
    await app.api(`/profiles/${p.id}/stop`, {});
  }
});
test('M14 real signed Firefox XPI: UI installation, restart, profile isolation and UI removal', { timeout: 120000 }, async t => {
  const file = process.env.PM_SIGNED_XPI, expectedHash = process.env.PM_SIGNED_XPI_SHA256;
  assert.ok(file && fs.existsSync(file) && /^[0-9a-f]{64}$/i.test(expectedHash || ''), 'A genuine Mozilla-signed XPI and pinned PM_SIGNED_XPI_SHA256 are required');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), expectedHash.toLowerCase());
  const app = await installation(t, 'pm-trackc-signed-xpi-', { MOZ_HEADLESS: '1' });
  const p = await app.api('/profiles', { name: 'Signed add-on target', browserEngine: 'firefox' });
  const isolated = await app.api('/profiles', { name: 'Separate profile', browserEngine: 'firefox' });
  const addon = await app.api('/gecko-extensions/import', { path: path.resolve(file) });
  // Keep valid ZIP CRCs and Mozilla signature metadata, but change signed
  // manifest bytes. Only real Firefox's cryptographic policy can accept/reject it.
  const entries = validateXpiArchive(fs.readFileSync(file)), manifest = JSON.parse(entries.get('manifest.json'));
  manifest.name = 'Tampered signed XPI fixture'; entries.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
  const damagedFile = path.join(app.dir, 'tampered.xpi'); fs.writeFileSync(damagedFile, buildXpi(Object.fromEntries(entries), { deflate: true }));
  const damaged = await app.api('/gecko-extensions/import', { path: damagedFile });
  const ui = await chromium.launch({ headless: true, ...(process.platform === 'linux' && process.getuid?.() === 0 ? { args: ['--no-sandbox'] } : {}) }); t.after(() => ui.close());
  const page = await ui.newPage();
  const manage = async (action, selectedAddon = addon, expectSuccess = true) => {
    await page.goto(app.url()); await page.locator('[data-nav="extensions"]').click();
    await page.getByRole('row').filter({ has: page.getByRole('cell', { name: selectedAddon.name, exact: true }) }).getByRole('button', { name: 'Manage in profile', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Manage ${selectedAddon.name} in Firefox` });
    await dialog.getByLabel('Firefox profile', { exact: true }).selectOption(p.id);
    const button = dialog.getByRole('button', { name: action === 'install' ? 'Install signed XPI' : 'Remove from profile', exact: true });
    assert.equal(await button.isDisabled(), true);
    await dialog.getByRole('checkbox').check();
    const responding = page.waitForResponse(r => r.url().endsWith(`/profiles/${p.id}/gecko-extensions/${selectedAddon.id}/${action}`) && r.request().method() === 'POST');
    await button.click(); const response = await responding, result = await response.json();
    if (!expectSuccess) { assert.equal(response.ok(), false, 'Modified signed bytes must be rejected by Firefox'); assert.match(JSON.stringify(result), /sign|corrupt|install/i); return result; }
    assert.ok(response.ok(), JSON.stringify(result));
    await dialog.getByRole('status').filter({ hasText: action === 'install' ? 'Permanent installation and signed package verified' : 'Removal verified' }).waitFor();
    return result;
  };
  const launch = id => app.api(`/profiles/${id}/launch`, { headless: true, automation: true });
  await launch(p.id);
  await manage('install', damaged, false);
  assert.equal(typeof addon.geckoExtensionId, 'string');
  assert.equal((await app.api(`/profiles/${p.id}/gecko-extensions`)).addons.some(a => a.id === addon.geckoExtensionId), false);
  const installed = await manage('install');
  assert.equal(installed.permanent, true); assert.equal(installed.addon.signatureVerified, true); assert.equal(installed.addon.active, true);
  await app.api(`/profiles/${p.id}/stop`, {}); await app.restart(); await launch(p.id);
  await eventually(() => app.api(`/profiles/${p.id}/gecko-extensions`), report => report.addons.some(a => a.id === installed.addon.id && a.active && a.signatureVerified), 'Signed add-on was not active after restart');
  await launch(isolated.id);
  assert.equal((await app.api(`/profiles/${isolated.id}/gecko-extensions`)).addons.some(a => a.id === installed.addon.id), false);
  await app.api(`/profiles/${isolated.id}/stop`, {});
  assert.equal((await manage('remove')).removed, true);
  await app.api(`/profiles/${p.id}/stop`, {}); await app.restart(); await launch(p.id);
  assert.equal((await app.api(`/profiles/${p.id}/gecko-extensions`)).addons.some(a => a.id === installed.addon.id), false);
  await app.api(`/profiles/${p.id}/stop`, {});
});
test('M38 actual UI creates, edits, encrypted-exports and restores complete workspace membership after restart', { timeout: 120000 }, async t => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'linux' && process.getuid?.() === 0 ? { args: ['--no-sandbox'] } : {}) }); t.after(() => browser.close());
  const a = await installation(t, 'pm-trackc-ui-A-'), b = await installation(t, 'pm-trackc-ui-B-');
  const page = await browser.newPage({ acceptDownloads: true });
  await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
  await page.goto(a.url()); await page.locator('[data-nav="workspaces"]').click(); await page.getByRole('button', { name: 'New workspace', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'New workspace', exact: true }); await dialog.getByLabel('Name', { exact: true }).fill('Portable team'); await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('cell', { name: 'Portable team', exact: true }).waitFor();
  const ws = (await a.api('/workspaces')).find(w => w.name === 'Portable team');
  const p = await a.api('/profiles', { name: 'Workspace member', browserEngine: 'firefox', workspaceId: ws.id });
  await page.getByRole('button', { name: 'Edit', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Edit workspace' });
  await dialog.getByLabel('Name', { exact: true }).fill('Portable edited'); await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Encrypted export', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Encrypted export: Portable edited' });
  await dialog.getByLabel('Passphrase', { exact: true }).fill('disposable-ui-passphrase'); await dialog.getByLabel('Repeat passphrase').fill('disposable-ui-passphrase'); await dialog.getByRole('checkbox').check();
  const download = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Download encrypted workspace' }).click();
  const archive = path.join(a.dir, 'ui-workspace.pmp'); await (await download).saveAs(archive); assert.equal(fs.readFileSync(archive).subarray(0, 4).toString(), 'PMBE');
  await page.goto(b.url()); await page.locator('[data-nav="workspaces"]').click(); await page.getByRole('button', { name: 'Restore encrypted workspace', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Restore encrypted workspace' });
  await dialog.getByLabel('Workspace archive').setInputFiles(archive); await dialog.getByLabel('Passphrase', { exact: true }).fill('disposable-ui-passphrase'); await dialog.getByRole('button', { name: 'Inspect workspace' }).click();
  await dialog.getByRole('status').waitFor(); await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Restore as new workspace' }).click();
  await page.getByRole('cell', { name: 'Portable edited', exact: true }).waitFor();
  await b.restart(); const restored = await b.api(`/profiles/${p.id}`); assert.equal(restored.workspaceId, ws.id); assert.equal(restored.browserEngine, 'firefox');
});
