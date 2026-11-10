import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { connect } from 'node:net';
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

test('signed Chrome uses the explicit proxy for loopback HTTP and WebSocket and refuses direct fallback after outage', { timeout: 75000 }, async () => {
  assert.equal(process.platform, 'win32');
  const stable = await resolveWindowsChromeStable();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-proxy-route-'));
  let context;
  let directHits = 0;
  const routed = new Set();
  const tunnels = new Set();
  const sockets = new Set();
  let webSocketPeer;
  const trap = createServer((_, res) => { directHits++; res.end('direct connection'); });
  trap.on('upgrade', (req, socket) => {
    sockets.add(socket);
    webSocketPeer = socket.remotePort;
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  });
  const relay = createServer((req, res) => {
    routed.add(req.url);
    res.setHeader('Connection', 'close');
    res.end('proxy connection');
  });
  try {
    const targetPort = await listen(trap);
    relay.on('connect', (req, client, head) => {
      sockets.add(client);
      if (req.url !== '127.0.0.1:' + targetPort) return client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      const upstream = connect(targetPort, '127.0.0.1', () => {
        tunnels.add(upstream.localPort);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        client.pipe(upstream).pipe(client);
      });
      sockets.add(upstream);
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
    });
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
    const wsUrl = 'ws://127.0.0.1:' + targetPort + '/websocket';
    const openSocket = url => page.evaluate(address => new Promise(resolve => {
      const socket = new WebSocket(address);
      const timer = setTimeout(() => { socket.close(); resolve(false); }, 5000);
      socket.onopen = () => { clearTimeout(timer); socket.close(); resolve(true); };
      socket.onerror = () => { clearTimeout(timer); resolve(false); };
    }), url);
    assert.equal(await openSocket(wsUrl), true);
    assert.ok(tunnels.has(webSocketPeer), 'WebSocket target peer is the relay tunnel, not Chrome');
    const peerBeforeOutage = webSocketPeer;
    for (const socket of sockets) socket.destroy();
    await close(relay);
    assert.equal(await openSocket(wsUrl + '-outage'), false);
    assert.equal(webSocketPeer, peerBeforeOutage);
    await assert.rejects(page.goto(url + '-outage', { timeout: 10000 }),
      /ERR_PROXY_CONNECTION_FAILED|ERR_CONNECTION_REFUSED/);
    assert.equal(directHits, 0);
  } finally {
    for (const socket of sockets) socket.destroy();
    try { await context?.close(); } finally {
      await Promise.all([close(relay), close(trap)]);
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
});
