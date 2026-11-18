import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-traffic-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'traffic-test';

const { startServer } = await import('../server/app.js');
let server;
let origin;
const hits = { html: 0, png: 0 };
const htmlBody = Buffer.from('page-html');
const pngBody = Buffer.alloc(180, 7);

const call = async (method, url, payload) => {
  const response = await fetch(server.url + url, {
    method,
    headers: { Authorization: 'Bearer traffic-test', 'Content-Type': 'application/json' },
    body: payload == null ? undefined : JSON.stringify(payload),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

before(async () => {
  origin = await new Promise((resolve, reject) => {
    const httpServer = http.createServer((req, res) => {
      if (req.url.startsWith('/page.html')) {
        hits.html += 1;
        res.writeHead(200, { 'content-type': 'text/html', 'content-length': String(htmlBody.length) });
        res.end(htmlBody);
        return;
      }
      if (req.url.startsWith('/pixel.png')) {
        hits.png += 1;
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(pngBody.length) });
        res.end(pngBody);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => {
      const port = httpServer.address().port;
      resolve({
        port,
        close: () => new Promise(done => httpServer.close(() => done())),
      });
    });
  });
  server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' });
});

after(async () => {
  if (origin) await origin.close();
  if (server) await server.close();
  try { const { db } = await import('../server/db.js'); db.close(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  delete process.env.PM_DATA_DIR;
  delete process.env.PM_API_TOKEN;
});

test('template traffic policy is stored and copied onto the live proxy', async () => {
  const created = await call('POST', '/api/v1/proxies/templates', {
    name: 'Metered preset',
    type: 'http',
    host: 'preset.example',
    port: 8080,
    trafficPolicy: { enabled: true, blockExtensions: ['png', '.jpg'] },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.trafficPolicy.enabled, true);
  assert.deepEqual(created.body.trafficPolicy.blockExtensions, ['.png', '.jpg']);
  const live = await call('POST', `/api/v1/proxies/templates/${created.body.id}/instantiate`, { name: 'Metered live' });
  assert.equal(live.status, 201);
  assert.equal(live.body.tags.includes('template'), false);
  assert.equal(live.body.trafficPolicy.enabled, true);
  assert.deepEqual(live.body.trafficPolicy.blockExtensions, ['.png', '.jpg']);
});

test('paired sessions report measured body-byte savings and do not fetch blocked images', async () => {
  const base = `http://127.0.0.1:${origin.port}`;
  const requests = [{ url: `${base}/page.html` }, { url: `${base}/pixel.png` }];
  const beforePng = hits.png;
  const baseline = await call('POST', '/api/v1/proxies/traffic/measure', {
    scriptId: 'fixture.http-1',
    policy: { enabled: false, blockExtensions: [] },
    requests,
  });
  assert.equal(baseline.status, 201, JSON.stringify(baseline.body));
  assert.equal(baseline.body.forwardedRequests, 2);
  assert.equal(baseline.body.blockedRequests, 0);
  assert.equal(baseline.body.originResponseBytes, htmlBody.length + pngBody.length);
  assert.equal(hits.png, beforePng + 1);
  const controlled = await call('POST', '/api/v1/proxies/traffic/measure', {
    scriptId: 'fixture.http-1',
    policy: { enabled: true, blockExtensions: ['.png'] },
    requests,
  });
  assert.equal(controlled.status, 201, JSON.stringify(controlled.body));
  assert.equal(controlled.body.blockedRequests, 1);
  assert.equal(controlled.body.forwardedRequests, 1);
  assert.equal(controlled.body.originResponseBytes, htmlBody.length);
  assert.equal(hits.png, beforePng + 1);
  const savings = await call('GET', `/api/v1/proxies/traffic/savings?baseline=${baseline.body.id}&controlled=${controlled.body.id}`);
  assert.equal(savings.body.comparable, true);
  assert.equal(savings.body.invented, false);
  assert.equal(savings.body.savingsBytes, pngBody.length);
  assert.equal(savings.body.byteBasis, 'origin-response-body');
  assert.equal(savings.body.savingsPercent, Math.round((pngBody.length / (htmlBody.length + pngBody.length)) * 1000) / 10);
  const mismatch = await call('GET', `/api/v1/proxies/traffic/savings?baseline=${baseline.body.id}&controlled=${baseline.body.id}`);
  assert.equal(mismatch.status, 400);
});

test('savings stay null when sessions are not a baseline/controlled pair', async () => {
  const base = `http://127.0.0.1:${origin.port}`;
  const requests = [{ url: `${base}/page.html` }];
  const a = await call('POST', '/api/v1/proxies/traffic/measure', {
    scriptId: 'fixture.http-a',
    policy: { enabled: false, blockExtensions: [] },
    requests,
  });
  const b = await call('POST', '/api/v1/proxies/traffic/measure', {
    scriptId: 'fixture.http-b',
    policy: { enabled: true, blockExtensions: ['.png'] },
    requests: [{ url: `${base}/pixel.png` }],
  });
  const savings = await call('GET', `/api/v1/proxies/traffic/savings?baseline=${a.body.id}&controlled=${b.body.id}`);
  assert.equal(savings.body.comparable, false);
  assert.equal(savings.body.savingsBytes, null);
  const remote = await call('POST', '/api/v1/proxies/traffic/measure', {
    scriptId: 'fixture.remote',
    policy: { enabled: false, blockExtensions: [] },
    requests: [{ url: 'http://example.com:80/page.html' }],
  });
  assert.equal(remote.status, 400);
  assert.equal(remote.body.code, 'INVALID_TRAFFIC_URL');
});
