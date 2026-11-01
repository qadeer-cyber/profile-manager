import './_isolated-data.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { db, DATA_DIR, userDataDir } from '../server/db.js';
import { buildXpi, demoManifest } from './_xpi-fixture.mjs';
import { importXpiGeckoExtension, readGeckoProfileExtensions } from '../server/gecko-extensions.js';
import { validatePermanentXpi, installGeckoExtension, removeGeckoExtension } from '../server/gecko-install.js';
import { firefoxSessionIdentity } from '../server/firefox-session.js';
import { requestFirefoxShutdown } from '../server/firefox-shutdown.js';

function profile() {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,browser_engine,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, 'Disposable Firefox', '[]', '', '', 'firefox', now, now);
  const dir = path.join(userDataDir(id), 'gecko'); fs.mkdirSync(dir, { recursive: true }); return { id, dir };
}
function library(signed = false) {
  const bytes = buildXpi({ 'manifest.json': demoManifest, ...(signed && { 'META-INF/mozilla.rsa': 'fabricated', 'META-INF/mozilla.sf': 'fabricated' }) });
  const file = path.join(DATA_DIR, crypto.randomUUID() + '.xpi'); fs.writeFileSync(file, bytes);
  return { bytes, row: importXpiGeckoExtension(file) };
}
test('Firefox runtime identity accepts only the canonical profile and a valid expected browser PID', () => {
  const p = profile(), capabilities = { browserName: 'firefox', 'moz:profile': p.dir, 'moz:processID': 123 };
  assert.deepEqual(firefoxSessionIdentity({ capabilities }, path.join(p.dir, '.'), 123), { pid: 123 });
  assert.deepEqual(firefoxSessionIdentity({ value: { capabilities } }, p.dir), { pid: 123 });
  for (const changed of [{ 'moz:profile': DATA_DIR }, { 'moz:processID': '123' }, { 'moz:processID': 0 }, { browserName: 'chrome' }]) {
    assert.throws(() => firefoxSessionIdentity({ capabilities: { ...capabilities, ...changed } }, p.dir), e => e.code === 'GECKO_SESSION_MISMATCH');
  }
  assert.throws(() => firefoxSessionIdentity({ capabilities }, p.dir, 456), e => e.code === 'GECKO_SESSION_MISMATCH');
});
test('Firefox graceful shutdown requests quit only from the matching browser and always closes its session', async () => {
  const p = profile(), commands = []; let closed = 0, windowRequests = 0, reportedPid = 123;
  const client = { command: async name => { commands.push(name); if (name === 'WebDriver:NewSession') return { capabilities: { browserName: 'firefox', 'moz:profile': p.dir, 'moz:processID': reportedPid } }; if (name === 'Marionette:Quit') throw Error('Marionette connection closed'); }, close: () => closed++ };
  const params = { pid: 123, profileDir: p.dir, marionettePort: 12345 };
  const controls = { connect: async () => client, matches: async () => true, closeWindow: async () => { windowRequests++; return false; } };
  assert.equal(await requestFirefoxShutdown(params, controls), true);
  assert.deepEqual(commands, ['WebDriver:NewSession', 'Marionette:Quit']); assert.equal(closed, 1); assert.equal(windowRequests, 0);
  commands.length = 0; reportedPid = 456;
  assert.equal(await requestFirefoxShutdown(params, controls), false);
  assert.deepEqual(commands, ['WebDriver:NewSession', 'WebDriver:DeleteSession']); assert.equal(closed, 2); assert.equal(windowRequests, 1);
  commands.length = 0;
  assert.equal(await requestFirefoxShutdown(params, { ...controls, matches: async () => false }), false);
  assert.deepEqual(commands, []); assert.equal(windowRequests, 1);
});
async function protocolFixture(t, p, mismatch = false) {
  const commands = [], sockets = new Set();
  const frame = value => { const b = Buffer.from(JSON.stringify(value)); return Buffer.concat([Buffer.from(b.length + ':'), b]); };
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.write(frame({ applicationType: 'gecko', marionetteProtocol: 3 })); let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const c = buffer.indexOf(58); if (c < 0) return; const length = Number(buffer.subarray(0, c)); if (buffer.length < c + length + 1) return;
        const message = JSON.parse(buffer.subarray(c + 1, c + length + 1)); buffer = buffer.subarray(c + length + 1); commands.push(message);
        const result = message[2] === 'WebDriver:NewSession' ? { capabilities: { browserName: 'firefox', 'moz:profile': mismatch ? DATA_DIR : p.dir, 'moz:processID': process.pid } } : {};
        const error = message[2] === 'Addon:Install' ? { error: 'unknown error', message: 'Signature verification failed (protocol rejection fixture)' } : null;
        socket.write(frame([1, message[1], error, result]));
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  db.prepare('INSERT INTO running VALUES (?,?,?,?,?,?)').run(p.id, process.pid, server.address().port, null, null, new Date().toISOString());
  t.after(async () => { db.prepare('DELETE FROM running WHERE id=?').run(p.id); for (const s of sockets) s.destroy(); await new Promise(resolve => server.close(resolve)); });
  return commands;
}
test('permanent add-ons reject unsigned archives, changed IDs and missing confirmation without assignments', async () => {
  const p = profile(), { bytes, row } = library();
  assert.throws(() => validatePermanentXpi(bytes, 'demo@test'), /Mozilla-signed/);
  assert.throws(() => validatePermanentXpi(bytes, 'other@test'), /identity/);
  await assert.rejects(() => installGeckoExtension(p.id, row.id), /Confirm/);
  await assert.rejects(() => installGeckoExtension(p.id, row.id, { confirm: true }), /Mozilla-signed/);
  await assert.rejects(() => removeGeckoExtension(p.id, row.id), /Confirm/);
  assert.equal(db.prepare('SELECT count(*) n FROM profile_extensions WHERE profile_id=?').get(p.id).n, 0);
});
test('Firefox metadata is bounded and missing active state never claims availability', () => {
  const p = profile(), file = path.join(p.dir, 'extensions.json');
  fs.writeFileSync(file, JSON.stringify({ addons: [{ id: 'demo@test', signedState: 2, appDisabled: false }] }));
  assert.equal(readGeckoProfileExtensions(p.dir).addons[0].active, false);
  const fd = fs.openSync(file, 'w'); fs.ftruncateSync(fd, 4 * 1024 * 1024 + 1); fs.closeSync(fd);
  assert.equal(readGeckoProfileExtensions(p.dir).corrupt, true);
  fs.writeFileSync(file, JSON.stringify({ addons: Array.from({ length: 1001 }, () => ({ id: 'demo@test' })) }));
  assert.equal(readGeckoProfileExtensions(p.dir).corrupt, true);
});
test('weakened signing preferences and unresolved recovery fail before contacting Firefox', async () => {
  const p = profile(), { row } = library(true);
  db.prepare('INSERT INTO running VALUES (?,?,?,?,?,?)').run(p.id, process.pid, 1, null, null, new Date().toISOString());
  fs.writeFileSync(path.join(p.dir, 'user.js'), 'user_pref("xpinstall.signatures.required", false);');
  await assert.rejects(() => installGeckoExtension(p.id, row.id, { confirm: true }), e => e.code === 'GECKO_SIGNING_POLICY');
  db.prepare('INSERT INTO pm_recovery_profile_locks VALUES (?,?)').run(p.id, crypto.randomUUID());
  try { await assert.rejects(() => installGeckoExtension(p.id, row.id, { confirm: true }), e => e.code === 'PROFILE_OPERATION_BUSY'); }
  finally { db.prepare('DELETE FROM pm_recovery_profile_locks WHERE profile_id=?').run(p.id); db.prepare('DELETE FROM running WHERE id=?').run(p.id); }
});
test('stale Marionette endpoint cannot install into another profile (protocol fixture)', async t => {
  const p = profile(), { row } = library(true), commands = await protocolFixture(t, p, true);
  await assert.rejects(() => installGeckoExtension(p.id, row.id, { confirm: true }), e => e.code === 'GECKO_SESSION_MISMATCH');
  assert.equal(commands.some(c => c[2] === 'Addon:Install'), false);
  assert.ok(commands.some(c => c[2] === 'WebDriver:DeleteSession'));
});
test('fabricated signature metadata is never success: permanent Firefox rejection propagates and closes session (protocol fixture)', async t => {
  const p = profile(), { row } = library(true), commands = await protocolFixture(t, p);
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(() => installGeckoExtension(p.id, row.id, { confirm: true }), /Signature verification failed/);
  assert.equal(commands.filter(c => c[2] === 'Addon:Install').length, 2);
  for (const c of commands.filter(c => c[2] === 'Addon:Install')) assert.equal(c[3].temporary, false);
  assert.equal(commands.filter(c => c[2] === 'WebDriver:DeleteSession').length, 2);
  assert.equal(db.prepare('SELECT count(*) n FROM profile_extensions WHERE profile_id=?').get(p.id).n, 0);
});
test('new Firefox install/remove HTTP actions require API authentication and explicit confirmation', async t => {
  process.env.PM_API_TOKEN = 'trackc-gecko-api';
  const { startServer } = await import('../server/app.js'); const server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' });
  t.after(async () => { await server.close(); delete process.env.PM_API_TOKEN; });
  const p = profile(), { row } = library();
  for (const action of ['install','remove']) {
    const url = `${server.url}/api/v1/profiles/${p.id}/gecko-extensions/${row.id}/${action}`;
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    const response = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer trackc-gecko-api', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 400); assert.match(JSON.stringify(await response.json()), /Confirm/);
  }
});
