// Strict protection on the real Windows launch path (the launcher guard was only unit-tested before). A Strict profile
// must be refused BEFORE any browser starts when a rule is broken, with every broken rule named, and must launch normally
// when all rules hold. Needs a build with every protection (canvas, identity, audio/screen, fonts, ClientRects/hints,
// media/WebRTC). Synthetic data; the proxy is a local authenticated fixture. Run by .github/workflows/azwah-native-live.yml.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Server } from 'proxy-chain';

const NEEDED = ['CANVAS', 'IDENTITY', 'AUDIO_SCREEN', 'GPU_FONTS', 'RECTS_UA', 'MEDIA_WEBRTC'];
const ALL_ON = { canvasReadback: 'prototype', hardwareIdentity: 'prototype', audioReadback: 'prototype', strict: 'on' };

test('Strict protection: refused before launch when a rule is broken, launches when every rule holds', { timeout: 300_000 }, async () => {
  assert.equal(process.platform, 'win32');
  for (const name of NEEDED) assert.equal(process.env['AZWAH_NATIVE_CHROMIUM_' + name], '1', 'this build lacks ' + name);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-strict-live-'));
  process.env.PM_DATA_DIR = directory;
  fs.cpSync('build/geoip-dbip', path.join(directory, 'geoip-dbip'), { recursive: true });
  fs.cpSync('build/geoip-dbip-asn', path.join(directory, 'geoip-dbip-asn'), { recursive: true });
  process.env.PM_API_TOKEN = randomUUID();
  const username = randomUUID(), password = randomUUID();
  let authenticated = 0;
  const proxy = new Server({ host: '127.0.0.1', port: 0, prepareRequestFunction: request => {
    const ok = request.username === username && request.password === password;
    if (ok) authenticated++;
    return { requestAuthentication: !ok };
  } });
  const { startServer } = await import('../server/app.js');
  const { userDataDir, db } = await import('../server/db.js');
  const engine = await import('../server/browsers.js');
  let server;
  const call = async (method, route, body) => {
    const response = await fetch(server.url + '/api/v1' + route, { method, body: body && JSON.stringify(body), signal: AbortSignal.timeout(90_000),
      headers: { Authorization: 'Bearer ' + process.env.PM_API_TOKEN, 'Content-Type': 'application/json' } });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const make = async (name, advancedSettings, withProxy) => {
    const created = await call('POST', '/profiles', { name, advancedSettings: { runtime: 'azwah-native', ...advancedSettings },
      ...(withProxy && { proxy: { type: 'http', host: '127.0.0.1', port: proxy.port, username, password } }) });
    assert.equal(created.status, 201, `${name}: ${JSON.stringify(created.body)}`);
    return created.body;
  };
  const nativeDir = id => path.join(userDataDir(id), 'azwah-native');
  try {
    await proxy.listen();
    server = await startServer({ port: 0, staticDir: null });

    // 1. Strict without a proxy: refused, nothing started, nothing created.
    const noProxy = await make('strict no proxy', { experimental: ALL_ON }, false);
    const refused = await call('POST', `/profiles/${noProxy.id}/launch`, { headless: false });
    console.log('# strict without proxy -> ' + refused.status + ' ' + JSON.stringify(refused.body));
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'STRICT_REQUIRES_PROXY');
    assert.match(refused.body.error, /Strict protection did not allow this launch/);
    assert.deepEqual(engine.runningIds(), [], 'no browser was started');
    assert.equal(fs.existsSync(nativeDir(noProxy.id)), false, 'no browser data folder was created');

    // 2. Strict with a proxy but one protection switched off: refused, and the broken rule is named.
    const switchedOff = await make('strict audio off', { experimental: { ...ALL_ON, audioReadback: 'off' } }, true);
    const refused2 = await call('POST', `/profiles/${switchedOff.id}/launch`, { headless: false });
    console.log('# strict with a protection off -> ' + refused2.status + ' ' + JSON.stringify(refused2.body));
    assert.equal(refused2.status, 409);
    assert.equal(refused2.body.code, 'STRICT_PROTECTIONS_OFF');
    assert.match(refused2.body.error, /audio protection/i);
    assert.deepEqual(engine.runningIds(), []);

    // 3. Two broken rules at once are both reported.
    const both = await make('strict two broken', { experimental: { ...ALL_ON, canvasReadback: 'off' } }, false);
    const refused3 = await call('POST', `/profiles/${both.id}/launch`, { headless: false });
    assert.equal(refused3.status, 409);
    assert.match(refused3.body.error, /needs a proxy/i); assert.match(refused3.body.error, /canvas protection/i);

    // 4. Every rule holds: it launches, goes through the proxy, and stops cleanly.
    const good = await make('strict ok', { experimental: ALL_ON }, true);
    const launched = await call('POST', `/profiles/${good.id}/launch`, { headless: false });
    assert.equal(launched.status, 200, JSON.stringify(launched.body));
    assert.ok(launched.body.pid, 'a browser process is running');
    assert.ok(fs.existsSync(path.join(nativeDir(good.id), 'Default')), 'its browser data exists');
    assert.ok(authenticated > 0, 'its traffic went through the authenticated proxy');
    console.log(`# strict profile launched pid=${launched.body.pid}; authenticated requests ${authenticated}`);
    assert.equal((await call('POST', `/profiles/${good.id}/stop`)).status, 200);
    console.log('# AZWAH_STRICT_LIVE pass');
  } finally {
    for (const id of engine.runningIds()) await engine.stop(id).catch(() => {});
    await server?.close();
    await proxy.close(true).catch(() => {});
    db.close();
    fs.rmSync(directory, { force: true, recursive: true, maxRetries: 8, retryDelay: 500 });
  }
});
