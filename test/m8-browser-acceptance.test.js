import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { spawnServer, stopServer } from './_ports.mjs';
import { startLocalHttpFixture } from './_local-http-fixture.mjs';
import { connectMarionette } from './_marionette-client.mjs';

function discoverStockFirefoxExecutable() {
  const configured = process.env.PM_FIREFOX_EXECUTABLE;
  if (configured && fs.existsSync(configured)) return configured;
  for (const c of ['/usr/bin/firefox', '/usr/bin/firefox-esr', '/Applications/Firefox.app/Contents/MacOS/firefox']) {
    if (fs.existsSync(c)) return c;
  }
  const cacheRoot = path.join(os.homedir(), '.cache/ms-playwright');
  if (fs.existsSync(cacheRoot)) {
    for (const name of fs.readdirSync(cacheRoot).filter(n => n.startsWith('firefox-')).sort().reverse()) {
      const exe = path.join(cacheRoot, name, 'firefox', process.platform === 'win32' ? 'firefox.exe' : 'firefox');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

for (const engine of ['chromium', 'firefox']) test(`M8 real ${engine}: create/configure/browse/stop/encrypted export/fresh restore/restart/readback`, { timeout: 120000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m8-browser-'));
  const fixture = await startLocalHttpFixture(); let a, b;
  t.after(async () => { if (a) assert.equal(await stopServer(a), true); if (b) assert.equal(await stopServer(b), true); await fixture.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });
  const token = 'disposable-m8-browser', headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const env = dir => {
    const e = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: token, MOZ_HEADLESS: '1' };
    delete e.PM_SECRET;
    const firefoxExe = discoverStockFirefoxExecutable();
    if (firefoxExe) e.PM_FIREFOX_EXECUTABLE = firefoxExe;
    return e;
  };
  const call = async (server, route, body) => {
    const response = await fetch(server.url + '/api/v1' + route, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result;
  };
  async function browse(server, id, seed) {
    const launched = await call(server, `/profiles/${id}/launch`, { headless: true, automation: true, url: fixture.origin });
    let value;
    if (engine === 'chromium') {
      const browser = await chromium.connectOverCDP(launched.cdp.httpEndpoint, { timeout: 15000 });
      try {
        const page = browser.contexts()[0].pages()[0]; await page.goto(fixture.origin);
        if (seed) await page.evaluate(() => { localStorage.setItem('m8', 'persistent-value'); document.cookie = 'm8=persistent-cookie; Max-Age=3600; SameSite=Lax; Path=/'; });
        value = await page.evaluate(() => ({ storage: localStorage.getItem('m8'), cookie: document.cookie }));
      } finally { await browser.close(); }
    } else {
      const client = await connectMarionette(launched.cdp.marionettePort);
      try {
        await client.command('WebDriver:NewSession', {});
        await client.command('WebDriver:Navigate', { url: fixture.origin });
        const script = (seed ? "localStorage.setItem('m8','persistent-value'); document.cookie='m8=persistent-cookie; Max-Age=3600; SameSite=Lax; Path=/';" : '') + "return {storage:localStorage.getItem('m8'),cookie:document.cookie};";
        const result = await client.command('WebDriver:ExecuteScript', { script, args: [], newSandbox: false, sandbox: 'default' });
        value = result?.value ?? result;
        await client.command('WebDriver:DeleteSession');
      } finally { client.close(); }
    }
    assert.equal(value.storage, 'persistent-value'); assert.match(value.cookie, /m8=persistent-cookie/);
    await call(server, `/profiles/${id}/stop`, {});
  }
  a = await spawnServer(env(path.join(root, 'A')));
  const profile = await call(a, '/profiles', { name: 'M8 real ' + engine, browserEngine: engine, automationEnabled: true, browserSettings: { locale: 'en-US', languages: ['en-US'], timezoneId: 'UTC' } });
  await browse(a, profile.id, true);
  let bytes, uiBrowser, uiPage;
  const archivePath = path.join(root, 'ui-export.pmp');
  {
    uiBrowser = await chromium.launch({ headless: true, ...(process.platform === 'linux' && process.getuid?.() === 0 ? { args: ['--no-sandbox'] } : {}) });
    t.after(() => uiBrowser.close());
    const context = await uiBrowser.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 768 } });
    await context.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
    uiPage = await context.newPage(); await uiPage.goto(a.url);
    await uiPage.locator('[data-nav="profiles"]').click();
    await uiPage.getByRole('button', { name: 'Export ' + profile.name, exact: true }).click();
    const dialog = uiPage.getByRole('dialog', { name: 'Export ' + profile.name });
    await dialog.getByLabel('Passphrase', { exact: true }).fill('disposable browser passphrase');
    await dialog.getByLabel('Repeat passphrase').fill('disposable browser passphrase');
    await dialog.getByRole('checkbox').check();
    const downloading = uiPage.waitForEvent('download'); await dialog.getByRole('button', { name: 'Download encrypted .pmp' }).click();
    await (await downloading).saveAs(archivePath); bytes = fs.readFileSync(archivePath);
  }
  assert.equal(bytes.subarray(0, 4).toString(), 'PMBE');
  assert.equal(await stopServer(a), true); a = null;
  b = await spawnServer(env(path.join(root, 'B')));
  if (uiPage) {
    await uiPage.goto(b.url); await uiPage.locator('[data-nav="settings"]').click();
    await uiPage.getByLabel('Restore passphrase', { exact: true }).fill('disposable browser passphrase');
    await uiPage.getByLabel('Inspect archive', { exact: true }).setInputFiles(archivePath);
    await uiPage.getByText('Restore preview', { exact: true }).waitFor();
    // Playwright cannot read restore-stream bodies after the SPA handles the upload (inspector cache eviction).
    // Validate the encrypted restore via UI completion plus API/readback instead of response.json().
    await uiPage.getByLabel('Restore archive', { exact: true }).setInputFiles(archivePath);
    await uiPage.locator('.toast.success').filter({ hasText: /Restored \d+ profiles/ }).waitFor({ timeout: 120000 });
    const restoredRow = await call(b, `/profiles/${profile.id}`);
    assert.equal(restoredRow.id, profile.id);
    assert.equal(restoredRow.name, profile.name);
  } else {
    const restored = await fetch(b.url + '/api/v1/backup/restore-stream', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'X-Backup-Passphrase': 'disposable browser passphrase' }, body: bytes });
    const result = await restored.json(); assert.equal(restored.status, 200, JSON.stringify(result)); assert.equal(result.added[0].id, profile.id);
  }
  await browse(b, profile.id, false);
  assert.equal(await stopServer(b), true); b = await spawnServer(env(path.join(root, 'B')));
  await browse(b, profile.id, false);
});
