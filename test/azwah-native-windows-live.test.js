// Part 4 qualification of AZWAH Chromium (the patched native browser) on Windows, run against the tested archive by
// .github/workflows/azwah-native-live.yml. Synthetic data only; the proxy is a local authenticated fixture whose exit
// is the runner's own network. Requires AZWAH_NATIVE_CHROMIUM_EXE / _SHA256 / _DLL_SHA256 for the archive under test.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Server } from 'proxy-chain';

const CYCLES = Number(process.env.AZWAH_NATIVE_CYCLES || 30);
const exitTypeOf = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8'))?.profile?.exit_type ?? null; } catch { return null; } };

test('AZWAH Chromium: authenticated proxy with proxy timezone, isolation and ' + CYCLES + ' clean stop/restart cycles', { timeout: 1_500_000 }, async () => {
  assert.equal(process.platform, 'win32');
  for (const name of ['AZWAH_NATIVE_CHROMIUM_EXE', 'AZWAH_NATIVE_CHROMIUM_SHA256', 'AZWAH_NATIVE_CHROMIUM_DLL_SHA256']) assert.ok(process.env[name], name);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-native-live-'));
  process.env.PM_DATA_DIR = directory;
  fs.cpSync('build/geoip-dbip', path.join(directory, 'geoip-dbip'), { recursive: true });
  fs.cpSync('build/geoip-dbip-asn', path.join(directory, 'geoip-dbip-asn'), { recursive: true });
  process.env.PM_API_TOKEN = randomUUID();
  const username = randomUUID();
  const password = randomUUID();
  let authenticated = 0;
  let rejected = 0;
  const proxy = new Server({ host: '127.0.0.1', port: 0, prepareRequestFunction: request => {
    const ok = request.username === username && request.password === password;
    if (ok) authenticated++; else rejected++;
    return { requestAuthentication: !ok };
  } });
  const { startServer } = await import('../server/app.js');
  const { getSetting, db, userDataDir } = await import('../server/db.js');
  const engine = await import('../server/browsers.js');
  let server;
  const ids = [];
  const api = async (method, route, body, status) => {
    const response = await fetch(server.url + '/api/v1' + route, {
      method, body: body && JSON.stringify(body), signal: AbortSignal.timeout(90_000),
      headers: { Authorization: 'Bearer ' + process.env.PM_API_TOKEN, 'Content-Type': 'application/json' },
    });
    const data = await response.json().catch(() => null);
    assert.equal(response.status, status, `${method} ${route}: ${JSON.stringify(data)}`);
    return data;
  };
  try {
    await proxy.listen();
    server = await startServer({ port: 0, staticDir: null });
    const proxied = await api('POST', '/profiles', { name: 'AZWAH proxy', advancedSettings: { runtime: 'azwah-native' },
      proxy: { type: 'http', host: '127.0.0.1', port: proxy.port, username, password } }, 201);
    const direct = await api('POST', '/profiles', { name: 'AZWAH direct', advancedSettings: { runtime: 'azwah-native' } }, 201);
    ids.push(proxied.id, direct.id);

    // Both at once: separate processes and separate data folders.
    const a = await api('POST', `/profiles/${proxied.id}/launch`, { headless: false }, 200);
    const b = await api('POST', `/profiles/${direct.id}/launch`, { headless: false }, 200);
    assert.ok(a.pid && b.pid && a.pid !== b.pid, 'two separate browser processes');
    const location = getSetting('proxy-location:' + proxied.id, null);
    assert.ok(location?.ip && location.timezone, 'proxy exit location resolved');
    assert.ok(location.browserExitVerifiedAt && location.nativeTimezoneVerifiedAt,
      'the patched browser confirmed the proxy exit IP and applied the proxy timezone (startup receipt)');
    console.log(`# proxy exit timezone ${location.timezone} (source ${location.source}); authenticated requests so far ${authenticated}`);
    assert.ok(authenticated > 0, 'browser traffic went through the authenticated proxy');
    const dirA = path.join(userDataDir(proxied.id), 'azwah-native');
    const dirB = path.join(userDataDir(direct.id), 'azwah-native');
    assert.notEqual(dirA, dirB);
    assert.ok(fs.existsSync(path.join(dirA, 'Default')) && fs.existsSync(path.join(dirB, 'Default')), 'each profile has its own browser data');
    await api('POST', `/profiles/${proxied.id}/stop`, null, 200);
    await api('POST', `/profiles/${direct.id}/stop`, null, 200);
    assert.equal(exitTypeOf(path.join(dirA, 'Default', 'Preferences')) === 'Crashed', false, 'proxy profile not marked Crashed');

    // Repeated stop/restart on the direct profile: never a Crashed marker, never left running.
    const prefs = path.join(dirB, 'Default', 'Preferences');
    const started = Date.now();
    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      const run = await api('POST', `/profiles/${direct.id}/launch`, { headless: false }, 200);
      assert.ok(run.pid, `cycle ${cycle} pid`);
      await new Promise(resolve => setTimeout(resolve, 1500));
      assert.equal(engine.isRunning(direct.id), true, `cycle ${cycle} running`);
      await api('POST', `/profiles/${direct.id}/stop`, null, 200);
      const exitType = exitTypeOf(prefs);
      assert.notEqual(exitType, 'Crashed', `cycle ${cycle} exit_type`);
      assert.equal(engine.isRunning(direct.id), false, `cycle ${cycle} stopped`);
      if (cycle % 10 === 0) console.log(`# cycle ${cycle}/${CYCLES} exit_type=${exitType} elapsed=${Math.round((Date.now() - started) / 1000)}s`);
    }
    assert.equal(JSON.stringify(getSetting('proxy-location:' + proxied.id, null) || {}).includes(password), false, 'no proxy password stored with the location');
    console.log(`# AZWAH_NATIVE_LIVE pass cycles=${CYCLES} authenticated=${authenticated} rejected=${rejected}`);
  } finally {
    for (const id of ids) await engine.stop(id).catch(() => {});
    await server?.close();
    await proxy.close(true);
    db.close();
    fs.rmSync(directory, { force: true, recursive: true, maxRetries: 8, retryDelay: 500 });
  }
});
