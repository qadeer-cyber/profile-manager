import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { resolveWindowsChromeStable, stableProxyNetworkArgs } from '../server/browser-runtime/chrome-stable.js';

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const close = server => new Promise((resolve, reject) => {
  if (!server.listening) return resolve();
  server.close(error => error ? reject(error) : resolve());
  server.closeAllConnections();
});

test('signed Chrome uses the explicit proxy for loopback HTTP and refuses direct fallback after outage', { timeout: 75000 }, async () => {
  assert.equal(process.platform, 'win32');
  const stable = await resolveWindowsChromeStable();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-proxy-route-'));
  let context;
  let directHits = 0;
  const routed = new Set();
  const trap = createServer((_, res) => { directHits++; res.end('direct connection'); });
  const relay = createServer((req, res) => {
    routed.add(req.url);
    res.setHeader('Connection', 'close');
    res.end('proxy connection');
  });
  try {
    const targetPort = await listen(trap);
    const proxyPort = await listen(relay);
    const proxy = 'http://127.0.0.1:' + proxyPort;
    context = await chromium.launchPersistentContext(dir, {
      executablePath: stable.path, chromiumSandbox: true, ignoreDefaultArgs: true,
      headless: false, viewport: null,
      args: ['--remote-debugging-pipe', '--user-data-dir=' + dir, '--no-first-run',
        '--proxy-server=' + proxy, '--proxy-bypass-list=<-loopback>',
        ...stableProxyNetworkArgs('127.0.0.1', false), 'about:blank'],
    });
    const page = context.pages()[0] || await context.newPage();
    const url = 'http://127.0.0.1:' + targetPort + '/azwah-route';
    const response = await page.goto(url, { timeout: 10000 });
    assert.equal(await response.text(), 'proxy connection');
    assert.ok(routed.has(url));
    assert.equal(directHits, 0);
    await close(relay);
    await assert.rejects(page.goto(url + '-outage', { timeout: 10000 }),
      /ERR_PROXY_CONNECTION_FAILED|ERR_CONNECTION_REFUSED/);
    assert.equal(directHits, 0);
  } finally {
    try { await context?.close(); } finally {
      await Promise.all([close(relay), close(trap)]);
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
});
