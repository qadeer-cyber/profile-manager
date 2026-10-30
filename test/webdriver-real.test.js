import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';

const enabled = process.env.PM_REAL_WEBDRIVER === '1';

test('real ChromeDriver session create/navigate/quit when PM_REAL_WEBDRIVER=1', { skip: !enabled, timeout: 180000 }, async () => {
  let chromedriverPath = process.env.PM_CHROMEDRIVER_PATH;
  if (!chromedriverPath) {
    try { chromedriverPath = execFileSync('which', ['chromedriver'], { encoding: 'utf8' }).trim(); } catch { assert.fail('Set PM_CHROMEDRIVER_PATH or install chromedriver'); }
  }
  const exe = chromium.executablePath();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-real-wd-'));
  const port = 9515;
  const proc = spawn(chromedriverPath, [`--port=${port}`], { stdio: 'ignore' });
  const browser = spawn(exe, [`--user-data-dir=${userDataDir}`, '--headless=new', `--remote-debugging-port=9222`, 'about:blank'], { stdio: 'ignore' });
  try {
    await new Promise(r => setTimeout(r, 1500));
    const session = await fetch(`http://127.0.0.1:${port}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capabilities: { alwaysMatch: { browserName: 'chrome', 'goog:chromeOptions': { debuggerAddress: '127.0.0.1:9222' } } } }),
    });
    assert.equal(session.status, 200);
    const sid = (await session.json()).value.sessionId;
    const nav = await fetch(`http://127.0.0.1:${port}/session/${sid}/url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'about:blank' }),
    });
    assert.equal(nav.status, 200);
    await fetch(`http://127.0.0.1:${port}/session/${sid}`, { method: 'DELETE' });
  } finally {
    browser.kill();
    proc.kill();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
