// Per-profile MAC label through the real API: each profile has its own label, a saved label persists,
// duplicates and malformed labels are refused, a clone gets its own label, and the label never reaches
// the browser launch arguments.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-mac-label-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'mac-label';
const { startServer } = await import('../server/app.js');
const { deriveMacLabel } = await import('../server/mac-label.js');
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

const MAC = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;

test('each new profile gets its own saved MAC; manual and random modes; duplicates refused; clone fresh; never launched', async () => {
  const a = (await call('POST', '/profiles', { name: 'mac A' })).body;
  const b = (await call('POST', '/profiles', { name: 'mac B' })).body;
  assert.match(a.macLabel, MAC);
  assert.equal(a.macLabelMode, 'random');
  assert.equal(a.advancedSettings.macLabel, a.macLabel, 'stored with the profile, not computed');
  assert.notEqual(a.macLabel, b.macLabel);

  const manual = await call('PUT', '/profiles/' + a.id, { advancedSettings: { macLabelMode: 'manual', macLabel: '02-ab-cd-ef-01-23' } });
  assert.equal(manual.status, 200, JSON.stringify(manual.body));
  assert.deepEqual([manual.body.macLabel, manual.body.macLabelMode], ['02:AB:CD:EF:01:23', 'manual']);
  const renamed = await call('PUT', '/profiles/' + a.id, { name: 'mac A renamed' });
  assert.deepEqual([renamed.body.macLabel, renamed.body.macLabelMode], ['02:AB:CD:EF:01:23', 'manual'], 'kept across other edits');

  const dup = await call('PUT', '/profiles/' + b.id, { advancedSettings: { macLabelMode: 'manual', macLabel: '02:AB:CD:EF:01:23' } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'MAC_LABEL_IN_USE');
  const dupCreate = await call('POST', '/profiles', { name: 'mac dup', advancedSettings: { macLabelMode: 'manual', macLabel: '02:ab:cd:ef:01:23' } });
  assert.equal(dupCreate.status, 409, 'duplicate refused at creation too');
  const bad = await call('PUT', '/profiles/' + b.id, { advancedSettings: { macLabelMode: 'manual', macLabel: '01:00:5E:00:00:01' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'INVALID_MAC_LABEL');
  const empty = await call('PUT', '/profiles/' + b.id, { advancedSettings: { macLabelMode: 'manual', macLabel: '' } });
  assert.equal(empty.status, 400, 'manual mode needs a value');

  const random = await call('PUT', '/profiles/' + b.id, { advancedSettings: { macLabelMode: 'random', macLabel: '06:11:22:33:44:55' } });
  assert.deepEqual([random.status, random.body.macLabel, random.body.macLabelMode], [200, '06:11:22:33:44:55', 'random']);

  const copy = (await call('POST', '/profiles/' + a.id + '/clone', { mode: 'settings' })).body;
  assert.match(copy.macLabel, MAC);
  assert.notEqual(copy.macLabel, '02:AB:CD:EF:01:23', 'a clone gets its own MAC');
  assert.equal(copy.macLabelMode, 'random');

  const template = await call('POST', '/templates', { profileId: a.id, name: 'mac template' });
  assert.equal(template.status, 201, JSON.stringify(template.body));
  const t1 = await call('POST', '/profiles/from-template/' + template.body.id, { name: 'from template 1' });
  const t2 = await call('POST', '/profiles/from-template/' + template.body.id, { name: 'from template 2' });
  assert.deepEqual([t1.status, t2.status], [201, 201], JSON.stringify([t1.body, t2.body]));
  assert.equal(new Set([a.macLabel, '02:AB:CD:EF:01:23', t1.body.macLabel, t2.body.macLabel]).size, 4, 'template copies get their own MACs');

  // A profile saved before MAC labels existed shows a stable label derived from its id.
  const { db } = await import('../server/db.js');
  db.prepare('UPDATE profiles SET advanced_settings=? WHERE id=?').run('{}', b.id);
  const legacy = (await call('GET', '/profiles/' + b.id)).body;
  assert.deepEqual([legacy.macLabel, legacy.macLabelMode], [deriveMacLabel(b.id), 'derived']);

  const { advancedLaunchPlan } = await import('../server/advanced-launch.js');
  const full = (await call('GET', '/profiles/' + a.id)).body;
  const plan = advancedLaunchPlan(full.advancedSettings, { headless: false, version: '150.0.0.0', platform: 'win32' });
  const reachesChrome = JSON.stringify([plan.args, plan.launch, plan.userAgent, plan.startupUrls, plan.permissions]);
  assert.ok(!/02:AB:CD:EF:01:23|02-AB-CD-EF-01-23|02abcdef0123/i.test(reachesChrome), 'the MAC never reaches Chrome');
});
