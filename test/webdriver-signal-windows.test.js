// Evidence for the owner-reported detection: BrowserScan flags "WebDriver" (navigator.webdriver === true)
// in AZWAH's Chrome Stable profiles, Google serves "unusual traffic" on the owner's own IP, and
// everyday Chrome on the same network does not. This records navigator.webdriver in real, headed
// Chrome Stable for each way the browser can be started, so the fix is chosen from evidence:
//   1. AZWAH's current launch (API -> Playwright pipe, Chrome's automation default switches removed)
//   2. chrome.exe started like a person starts it (no pipe, no Playwright)
//   3. chrome.exe with only --remote-debugging-pipe added (is the pipe itself the trigger?)
//   4. chrome.exe with the pipe and --disable-blink-features=AutomationControlled
// Each page reports navigator.webdriver to a loopback server, so no automation is needed to read it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

test('real Chrome Stable: navigator.webdriver for each launch mode', { timeout: 240000 }, async t => {
  if (process.platform !== 'win32') { t.skip('Chrome Stable runtime is Windows-only'); return; }
  const { resolveWindowsChromeStable } = await import('../server/browser-runtime/chrome-stable.js');
  let stable;
  try { stable = await resolveWindowsChromeStable(); } catch (error) { t.skip(`Chrome Stable not available: ${error.code || error.message}`); return; }

  const reports = new Map();
  const site = http.createServer((req, res) => {
    const m = /^\/report\/([a-z0-9-]+)\?(true|false|undefined)$/.exec(req.url);
    if (m) { reports.set(m[1], m[2]); res.end('ok'); return; }
    const mode = (req.url.split('/')[1] || 'none').replace(/[^a-z0-9-]/g, '');
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<title>webdriver</title><script>fetch('/report/${mode}?' + String(navigator.webdriver))</script>`);
  });
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${site.address().port}`;
  const waitFor = async mode => { for (let i = 0; i < 120 && !reports.has(mode); i++) await new Promise(r => setTimeout(r, 250)); return reports.get(mode) ?? 'no-report'; };
  const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-webdriver-'));
  const results = {};
  const direct = async (mode, extra, stdio = 'ignore') => {
    const child = spawn(stable.path, ['--no-first-run', '--no-default-browser-check', `--user-data-dir=${temp()}`, ...extra, `${origin}/${mode}`], { stdio, windowsHide: false });
    try { results[mode] = await waitFor(mode); } finally { child.kill(); await new Promise(r => setTimeout(r, 1500)); }
  };

  // 1. AZWAH's current launch path, through the API.
  const dir = temp();
  process.env.PM_DATA_DIR = dir;
  process.env.PM_API_TOKEN = 'webdriver-token';
  const { startServer } = await import('../server/app.js');
  const server = await startServer({ port: 0, staticDir: null });
  const api = async (method, route, body) => (await fetch(server.url + '/api/v1' + route, { method, body: body && JSON.stringify(body),
    headers: { Authorization: 'Bearer webdriver-token', 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(90000) })).json();
  try {
    const p = await api('POST', '/profiles', { name: 'webdriver probe', advancedSettings: { runtime: 'stable-chrome' } });
    const launched = await api('POST', `/profiles/${p.id}/launch`, { headless: false, url: `${origin}/azwah-current` });
    assert.equal(launched.error, undefined, JSON.stringify(launched));
    results['azwah-current'] = await waitFor('azwah-current');
    if (results['azwah-current'] === 'no-report') {
      const { liveContext } = await import('../server/browsers.js');
      await (await liveContext(p.id).newPage()).goto(`${origin}/azwah-current`);
      results['azwah-current'] = await waitFor('azwah-current');
    }
    await api('POST', `/profiles/${p.id}/stop`);
  } finally { await server.close(); }

  // 2-4. chrome.exe started directly.
  await direct('plain', []);
  await direct('pipe-only', ['--remote-debugging-pipe'], ['ignore', 'ignore', 'ignore', 'pipe', 'pipe']);
  await direct('pipe-disable-automation-controlled', ['--remote-debugging-pipe', '--disable-blink-features=AutomationControlled'], ['ignore', 'ignore', 'ignore', 'pipe', 'pipe']);
  site.close();

  console.log('WEBDRIVER_SIGNAL ' + JSON.stringify({ chrome: stable.version, results }));
  // Evidence run: every mode must have reported. The fix's regression assertion follows from this data.
  for (const [mode, value] of Object.entries(results)) assert.notEqual(value, 'no-report', `${mode} did not report`);
});
