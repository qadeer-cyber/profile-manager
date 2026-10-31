import './_isolated-data.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildFirefoxLaunchPlan, geckoUserDataDir } from '../server/browser-runtime/firefox-launch.js';

test('gecko profile dir is under chromium userDataDir', () => {
  const id = randomUUID();
  const base = path.join(os.tmpdir(), 'pm-gecko');
  const g = geckoUserDataDir(id, () => path.join(base, id));
  assert.ok(g.includes('gecko'));
});

test('firefox launch plan uses -no-remote and -profile', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ff-'));
  process.env.PM_DATA_DIR = dataDir;
  const fakeExe = path.join(dataDir, 'firefox-stub.exe');
  fs.writeFileSync(fakeExe, '');
  const { setSetting } = await import('../server/db.js');
  setSetting('firefoxExecutablePath', fakeExe);
  const id = randomUUID();
  const now = new Date().toISOString();
  const { db } = await import('../server/db.js');
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, 'ff', '[]', '', '', now, now);
  const p = { id, browserSettings: { locale: 'en-US', timezoneId: '', languages: ['en-US'] }, proxy: null };
  const dir = path.join(dataDir, 'profiles', id);
  fs.mkdirSync(dir, { recursive: true });
  const plan = await buildFirefoxLaunchPlan(p, { userDataDir: dir, opts: { automation: false, headless: false } });
  assert.equal(plan.engine, 'firefox');
  assert.ok(plan.args.includes('-no-remote'));
  const autoPlan = await buildFirefoxLaunchPlan(p, { userDataDir: dir, opts: { automation: true, headless: false } });
  assert.ok(autoPlan.args.includes('-marionette'));
  assert.ok(autoPlan.marionettePort > 0);
  assert.ok(plan.args.some(a => a === '-profile' || String(a).includes('gecko')));
  assert.equal(plan.args.some(a => String(a).includes('--disable-webgl')), false);
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.PM_DATA_DIR;
});

test('automation writes its selected Marionette port into managed Firefox prefs', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ff-port-'));
  const { setSetting } = await import('../server/db.js');
  const exe = path.join(dataDir, 'firefox-stub.exe'); fs.writeFileSync(exe, ''); setSetting('firefoxExecutablePath', exe);
  try {
    const id = randomUUID();
    const plan = await buildFirefoxLaunchPlan({ id, browserSettings: { locale: '', languages: [], timezoneId: '' } }, { userDataDir: path.join(dataDir, id), opts: { automation: true } });
    assert.ok(plan.marionettePort > 0); assert.ok(plan.args.includes('-marionette'));
    assert.ok(fs.readFileSync(path.join(plan.profileDir, 'user.js'), 'utf8').includes(`user_pref("marionette.port", ${plan.marionettePort});`));
  } finally { setSetting('firefoxExecutablePath', ''); fs.rmSync(dataDir, { recursive: true, force: true }); }
});
