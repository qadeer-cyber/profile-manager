import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

test('real Chromium managed attachment, cancellation, crash recovery and isolation', { timeout: 120_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-managed-'));
  process.env.PM_DATA_DIR = dir;
  process.env.PM_API_TOKEN = 'local-test-token';
  const { startServer } = await import('../server/app.js');
  const { db } = await import('../server/db.js');
  const fixture = createServer((req, res) => res.end('<title>Managed fixture</title>'));
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + fixture.address().port;
  const clients = [];
  let app;
  try {
    app = await startServer({ port: 0, staticDir: null });
    console.log('Managed fixture server ready');
    async function api(method, route, body, expected = 200) {
      const response = await fetch(app.url + '/api/v1' + route, {
        method, signal: AbortSignal.timeout(30_000), headers: { Authorization: 'Bearer local-test-token', 'Content-Type': 'application/json' },
        body: body && JSON.stringify(body),
      });
      const data = await response.json();
      assert.equal(response.status, expected, JSON.stringify(data));
      return data;
    }
    async function start(id) {
      await api('POST', '/profiles/' + id + '/launch', { headless: true });
      const state = await api('POST', '/profiles/' + id + '/automation-sessions', null, 201);
      const browser = await chromium.connectOverCDP(state.endpoint);
      clients.push(browser);
      const page = await browser.contexts()[0].newPage();
      await page.goto(origin);
      return { browser, page, endpoint: state.endpoint, session: state.sessions[0] };
    }

    const a = await api('POST', '/profiles', { name: 'Managed A', automationEnabled: true }, 201);
    const b = await api('POST', '/profiles', { name: 'Managed B', automationEnabled: true }, 201);
    const first = await start(a.id);
    console.log('First Chromium profile attached');
    const second = await start(b.id);
    console.log('Second Chromium profile attached');
    assert.notEqual(first.endpoint, second.endpoint);
    await first.page.evaluate(() => localStorage.setItem('fixture', 'profile-a'));
    assert.equal(await second.page.evaluate(() => localStorage.getItem('fixture')), null);
    const routeA = '/profiles/' + a.id + '/automation-sessions';
    const cancelled = await api('POST', routeA + '/' + first.session.id + '/cancel');
    assert.equal(cancelled.sessions[0].status, 'cancelled');
    assert.equal(cancelled.endpoint, null);
    console.log('First Chromium profile cancelled');
    assert.equal(await second.page.title(), 'Managed fixture');

    const routeB = '/profiles/' + b.id + '/automation-sessions';
    const runningB = await api('GET', '/profiles/' + b.id);
    assert.ok(runningB.pid > 0);
    process.kill(runningB.pid, 'SIGKILL');
    let crashed;
    for (let i = 0; i < 80; i++) {
      crashed = await api('GET', routeB);
      if (crashed.sessions[0].status === 'interrupted' &&
          !(await api('GET', '/profiles/' + b.id)).running) break;
      await delay(250);
    }
    assert.equal(crashed.sessions[0].status, 'interrupted');
    assert.equal(crashed.endpoint, null);
    assert.equal((await api('GET', '/profiles/' + b.id)).running, false);
    console.log('Crashed Chromium profile settled');
    const recovered = await start(b.id);
    assert.notEqual(recovered.session.id, second.session.id);
    const relaunched = await start(a.id);
    assert.equal(await relaunched.page.evaluate(() => localStorage.getItem('fixture')), 'profile-a');
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    try { await app?.close(); } finally {
      fixture.close();
      fixture.closeAllConnections();
      db.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
});
