import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { freePort } from './_ports.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('cancel interrupts navigation twice, preserves pending URLs and leaves personal tabs alone', { timeout: 25000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-robot-abort-'));
  process.env.PM_DATA_DIR = dir;
  const { runCookieRobotTasksOverCdp } = await import('../server/cookie-robot-jobs.js');
  const { db } = await import('../server/db.js');
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const site = http.createServer();
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  t.after(() => { site.closeAllConnections(); site.close(); });
  const origin = 'http://127.0.0.1:' + site.address().port;
  const port = await freePort('PM_TEST_CR_ABORT');
  const browser = await chromium.launch({ executablePath: chromium.executablePath(), args: ['--remote-debugging-port=' + port] });
  t.after(() => browser.close());
  const cdp = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  t.after(() => cdp.close());
  const ctx = cdp.contexts()[0];
  const personal = await ctx.newPage();
  await ctx.addCookies([{ name: 'marker', value: 'keep', url: origin }]);
  const before = ctx.pages().length;
  const requests = [];
  site.on('request', req => requests.push(req.url));
  for (let i = 0; i < 2; i++) {
    const controller = new AbortController();
    const requested = once(site, 'request');
    const tasks = ['/wait', '/later'].map(route => ({ url: origin + route, status: 'pending' }));
    const running = runCookieRobotTasksOverCdp(port, tasks, { signal: controller.signal });
    await requested;
    controller.abort();
    assert.deepEqual(await running, tasks);
    assert.equal(ctx.pages().length, before);
    assert.equal(personal.url(), 'about:blank');
  }
  assert.deepEqual(requests, ['/wait', '/wait']);
  assert.equal((await ctx.cookies(origin))[0].value, 'keep');
});
