import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Server } from 'proxy-chain';
import { publicIp } from '../server/proxy-location.js';

function socksFixture(username, password, accepted) {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
    let phase = 0;
    let bytes = Buffer.alloc(0);
    socket.on('data', function handshake(chunk) {
      bytes = Buffer.concat([bytes, chunk]);
      if (phase === 0 && bytes.length >= 2 + (bytes[1] ?? 0)) {
        if (bytes[0] !== 5 || !bytes.subarray(2, 2 + bytes[1]).includes(2)) return socket.end(Buffer.from([5, 255]));
        bytes = bytes.subarray(2 + bytes[1]);
        phase = 1;
        socket.write(Buffer.from([5, 2]));
      }
      if (phase === 1 && bytes.length >= 3 + (bytes[1] ?? 0)) {
        const userLength = bytes[1];
        const passLength = bytes[2 + userLength];
        const end = 3 + userLength + passLength;
        if (bytes.length < end) return;
        if (bytes[0] !== 1 || bytes.subarray(2, 2 + userLength).toString() !== username ||
            bytes.subarray(3 + userLength, end).toString() !== password) return socket.end(Buffer.from([1, 1]));
        bytes = bytes.subarray(end);
        phase = 2;
        socket.write(Buffer.from([1, 0]));
      }
      if (phase !== 2 || bytes.length < 5) return;
      if (bytes[0] !== 5 || bytes[1] !== 1 || bytes[3] !== 3) return socket.destroy();
      const end = 5 + bytes[4] + 2;
      if (bytes.length < end) return;
      const host = bytes.subarray(5, end - 2).toString();
      const port = bytes.readUInt16BE(end - 2);
      if (host !== 'api64.ipify.org' || port !== 443) return socket.destroy();
      const extra = bytes.subarray(end);
      socket.removeListener('data', handshake);
      const upstream = net.connect({ host, port }, () => {
        accepted();
        socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
        if (extra.length) upstream.write(extra);
        socket.pipe(upstream).pipe(socket);
      });
      upstream.on('error', () => socket.destroy());
      socket.once('close', () => upstream.destroy());
    });
  });
  return {
    get port() { return server.address()?.port; },
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }),
    close: () => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(resolve); }),
  };
}

const protocol = process.env.PM_TEST_SOCKS5 === '1' ? 'socks5' : 'http';
test('signed Chrome verifies an authenticated ' + protocol + ' public-egress proxy without MaxMind', { timeout: 120_000 }, async () => {
  assert.equal(process.platform, 'win32');
  delete process.env.AZWAH_MAXMIND_ACCOUNT_ID;
  delete process.env.AZWAH_MAXMIND_LICENSE_KEY;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-dbip-live-'));
  process.env.PM_DATA_DIR = directory;
  fs.cpSync('build/geoip-dbip', path.join(directory, 'geoip-dbip'), { recursive: true });
  process.env.PM_API_TOKEN = randomUUID();
  const username = randomUUID();
  const password = randomUUID();
  let authenticated = 0;
  const proxy = protocol === 'socks5' ? socksFixture(username, password, () => { authenticated++; }) : new Server({ host: '127.0.0.1', port: 0, prepareRequestFunction: request => {
    const allowed = request.username === username && request.password === password &&
      request.hostname === 'api64.ipify.org' && request.port === 443;
    if (allowed) authenticated++;
    return { requestAuthentication: !allowed };
  } });
  const { startServer } = await import('../server/app.js');
  const { getSetting, db } = await import('../server/db.js');
  const engine = await import('../server/browsers.js');
  let server;
  let profile;
  try {
    await proxy.listen();
    server = await startServer({ port: 0, staticDir: null });
    async function api(route, body, status) {
      const response = await fetch(server.url + '/api/v1' + route, {
        method: 'POST', body: JSON.stringify(body),
        headers: { Authorization: 'Bearer ' + process.env.PM_API_TOKEN, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(55_000),
      });
      const data = await response.json();
      assert.equal(response.status, status, data.code || 'Unexpected API status');
      return data;
    }
    if (protocol === 'socks5') {
      const denied = await api('/profiles', {
        name: 'Rejected SOCKS5 fixture', advancedSettings: { runtime: 'stable-chrome' },
        proxy: { type: protocol, host: '127.0.0.1', port: proxy.port, username, password: randomUUID() },
      }, 201);
      const result = await api('/profiles/' + denied.id + '/launch', { headless: false }, 503);
      assert.equal(result.code, 'PROXY_AUTH_REQUIRED');
    }
    profile = await api('/profiles', {
      name: 'Automatic DB-IP acceptance',
      advancedSettings: { runtime: 'stable-chrome' },
      proxy: { type: protocol, host: '127.0.0.1', port: proxy.port, username, password },
    }, 201);
    const route = '/profiles/' + profile.id;
    for (let launch = 0; launch < 2; launch++) {
      await api(route + '/launch', { headless: false }, 200);
      const result = getSetting('proxy-location:' + profile.id, null);
      assert.equal(result.source, 'DB-IP City Lite');
      assert.ok(publicIp(result.ip));
      assert.ok(result.browserVerifiedAt);
      const context = engine.liveContext(profile.id);
      const page = context.pages()[0] || await context.newPage();
      assert.equal(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), result.timezone);
      await engine.stop(profile.id);
    }
    assert.ok(authenticated >= 3, 'Proxy must receive authenticated outbound traffic');
  } finally {
    if (profile) await engine.stop(profile.id).catch(() => {});
    await server?.close();
    await proxy.close(true);
    db.close();
    fs.rmSync(directory, { force: true, recursive: true });
  }
});
