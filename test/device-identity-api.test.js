// Device Identity through the real API: unsupported presets are refused without being stored,
// supported ones persist across a server restart and survive cloning, and verification of a
// stopped profile is never "pass".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-device-identity-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'device-identity';
const { startServer } = await import('../server/app.js');
let server;
const call = async (method, route, body) => {
  const r = await fetch(server.url + '/api' + route, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
before(async () => { server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' }); });
after(async () => {
  await server?.close();
  try { const { db } = await import('../server/db.js'); db.close(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

test('device identity matrix, refusal of unsupported presets, persistence and cloning', async () => {
  const matrix = await call('GET', '/device-identity');
  assert.equal(matrix.status, 200);
  assert.equal(matrix.body.presets.length, 10);
  const ok = matrix.body.presets.filter(p => p.state === 'supported').map(p => p.id);
  const refused = matrix.body.presets.filter(p => p.state !== 'supported');
  assert.ok(ok.includes('host'));
  assert.ok(refused.some(p => p.id === 'iphone') && refused.every(p => p.reason));

  const created = await call('POST', '/profiles', { name: 'Device identity' });
  assert.equal(created.status, 201);
  const id = created.body.id;

  for (const preset of refused) {
    const put = await call('PUT', '/profiles/' + id, { advancedSettings: { deviceIdentity: { preset: preset.id } } });
    assert.equal(put.status, 400, `${preset.id} must be refused`);
    assert.equal(put.body.code, 'INVALID_ADVANCED_SETTINGS');
  }
  const unchanged = await call('GET', '/profiles/' + id);
  assert.equal('deviceIdentity' in unchanged.body.advancedSettings, false, 'refused presets were not stored');
  const rejectedCreate = await call('POST', '/profiles', { name: 'Refused', advancedSettings: { deviceIdentity: { preset: 'android-phone' } } });
  assert.equal(rejectedCreate.status, 400);

  const explicit = ok.find(p => p !== 'host');
  if (explicit) {
    const saved = await call('PUT', '/profiles/' + id, { advancedSettings: { deviceIdentity: { preset: explicit } } });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.advancedSettings.deviceIdentity, { preset: explicit });
    // An unrelated save keeps the preset.
    const renamed = await call('PUT', '/profiles/' + id, { name: 'Device identity renamed' });
    assert.deepEqual(renamed.body.advancedSettings.deviceIdentity, { preset: explicit });
    // Restart the API server on the same data directory.
    await server.close();
    server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' });
    const reloaded = await call('GET', '/profiles/' + id);
    assert.deepEqual(reloaded.body.advancedSettings.deviceIdentity, { preset: explicit }, 'preset survives restart');
    const clone = await call('POST', `/profiles/${id}/clone`, { mode: 'settings' });
    assert.ok([200, 201].includes(clone.status), JSON.stringify(clone.body));
    const cloned = await call('GET', '/profiles/' + clone.body.id);
    assert.deepEqual(cloned.body.advancedSettings.deviceIdentity, { preset: explicit }, 'clone keeps the preset');
  }

  const report = await call('GET', `/profiles/${id}/hardware`);
  const row = report.body.consistency.byCategory.find(r => r.id === 'deviceIdentity');
  assert.equal(row.status, 'unavailable', 'a stopped profile is never verified');
});
