import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { freePort, hardKill, trackProcess } from './_ports.mjs';
import { startLocalHttpFixture } from './_local-http-fixture.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(root, route, method = 'GET', body) {
  const response = await fetch(root + route, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result.value;
}
async function ready(url, proc) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null || proc.signalCode !== null) throw new Error('Driver exited before readiness');
    try { await request(url, '/status'); return; } catch { await sleep(100); }
  }
  throw new Error('Driver readiness timed out');
}
async function killAndWait(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  const closed = new Promise(resolve => proc.once('close', resolve));
  hardKill(proc.pid);
  await Promise.race([closed, sleep(5000)]);
}

for (const engine of ['chrome', 'firefox']) {
  const enabled = process.env[engine === 'chrome' ? 'PM_REAL_WEBDRIVER' : 'PM_REAL_GECKODRIVER'] === '1';
  test(`real ${engine} WebDriver navigates, interacts, and isolates two persistent profiles`, { skip: !enabled, timeout: 180000 }, async t => {
    const driver = process.env[engine === 'chrome' ? 'PM_CHROMEDRIVER_PATH' : 'PM_GECKODRIVER_PATH'];
    assert.ok(driver, `Set PM_${engine === 'chrome' ? 'CHROMEDRIVER' : 'GECKODRIVER'}_PATH`);
    const fixture = await startLocalHttpFixture({ body: '<title>webdriver fixture</title><input id="text">' });
    t.after(() => fixture.close());
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-real-wd-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
    const port = await freePort();
    const proc = trackProcess(spawn(driver, [`--port=${port}`, ...(engine === 'firefox' ? ['--host=127.0.0.1'] : ['--allowed-ips=127.0.0.1'])], { stdio: 'ignore', detached: process.platform !== 'win32', windowsHide: true }));
    let spawnError;
    proc.on('error', error => { spawnError = error; });
    t.after(() => killAndWait(proc));
    const root = `http://127.0.0.1:${port}`;
    await ready(root, proc);
    assert.equal(spawnError, undefined);
    for (const [index, expected] of [[0, null], [1, null], [0, 'profile-0']]) {
      const profile = path.join(dir, `profile-${index}`); fs.mkdirSync(profile, { recursive: true });
      const options = engine === 'chrome'
        ? { 'goog:chromeOptions': { binary: chromium.executablePath(), args: ['--headless=new', `--user-data-dir=${profile}`, ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [])] } }
        : { 'moz:firefoxOptions': { ...(process.env.PM_FIREFOX_PATH ? { binary: process.env.PM_FIREFOX_PATH } : {}), args: ['-headless', '-profile', profile] } };
      const session = await request(root, '/session', 'POST', { capabilities: { alwaysMatch: { browserName: engine, ...options } } });
      assert.ok(session.sessionId); const route = `/session/${session.sessionId}`;
      try {
        await request(root, route + '/url', 'POST', { url: fixture.origin });
        assert.equal(await request(root, route + '/title'), 'webdriver fixture');
        const rect = await request(root, route + '/window/rect');
        assert.equal(typeof rect.width, 'number');
        assert.ok(rect.width > 0);
        const element = await request(root, route + '/element', 'POST', { using: 'css selector', value: '#text' });
        const id = element['element-6066-11e4-a52e-4f735466cecf']; assert.ok(id);
        await request(root, route + `/element/${id}/value`, 'POST', { text: 'Hello اردو' });
        assert.equal(await request(root, route + `/element/${id}/property/value`), 'Hello اردو');
        assert.equal(await request(root, route + '/execute/sync', 'POST', { script: 'return localStorage.getItem("isolation")', args: [] }), expected);
        await request(root, route + '/execute/sync', 'POST', { script: 'localStorage.setItem("isolation", arguments[0])', args: [`profile-${index}`] });
      } finally { await request(root, route, 'DELETE'); }
    }
  });
}
