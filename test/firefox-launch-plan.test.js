import './_isolated-data.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildFirefoxLaunchPlan, geckoUserDataDir, geckoDescendants, discoverGeckoBrowserPid, firefoxProcessEnv } from '../server/browser-runtime/firefox-launch.js';

test('gecko profile dir is under chromium userDataDir', () => {
  const id = randomUUID();
  const base = path.join(os.tmpdir(), 'pm-gecko');
  const g = geckoUserDataDir(id, () => path.join(base, id));
  assert.ok(g.includes('gecko'));
});

test('explicit headed Firefox removes even empty inherited MOZ_HEADLESS without mutating the parent environment', () => {
  for (const value of ['', '1', '0']) {
    const parent = { MOZ_HEADLESS: value, TZ: 'Europe/London', PATH: 'unchanged' };
    const visible = firefoxProcessEnv({ headless: false, marionettePort: 12345, timezoneId: 'UTC' }, parent);
    assert.equal(Object.hasOwn(visible, 'MOZ_HEADLESS'), false);
    assert.equal(visible.MARIONETTE_PORT, '12345'); assert.equal(visible.TZ, 'UTC'); assert.equal(visible.PATH, 'unchanged');
    assert.equal(parent.MOZ_HEADLESS, value); assert.equal(parent.TZ, 'Europe/London');
    assert.equal(firefoxProcessEnv({ headless: true }, parent).MOZ_HEADLESS, '1');
  }
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
  assert.equal(plan.args.includes('-wait-for-browser'), process.platform === 'win32');
  const autoPlan = await buildFirefoxLaunchPlan(p, { userDataDir: dir, opts: { automation: true, headless: false } });
  assert.ok(autoPlan.args.includes('-marionette'));
  assert.ok(autoPlan.marionettePort > 0);
  const headlessPlan = await buildFirefoxLaunchPlan(p, { userDataDir: dir, opts: { automation: true, headless: true } });
  assert.ok(headlessPlan.args.includes('-headless'));
  assert.equal(headlessPlan.headless, true);
  const prefs = fs.readFileSync(path.join(headlessPlan.profileDir, 'user.js'), 'utf8');
  assert.match(prefs, /user_pref\("xpinstall.signatures.required", true\)/);
  assert.match(prefs, /user_pref\("xpinstall.signatures.dev-root", false\)/);
  assert.ok(plan.args.some(a => a === '-profile' || String(a).includes('gecko')));
  assert.equal(plan.args.some(a => String(a).includes('--disable-webgl')), false);
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.PM_DATA_DIR;
});

test('Firefox Windows discovery selects the owned browser child, not the waiting launcher', async () => {
  const parents = [{ pid: 11, parentPid: 10 }, { pid: 12, parentPid: 11 }, { pid: 90, parentPid: 1 }];
  assert.deepEqual(geckoDescendants([10], parents), [11, 12]);
  const inspected = [];
  assert.equal(await discoverGeckoBrowserPid('disposable-profile', [10], 500, {
    platform: 'win32', parents: async () => parents, alive: () => true,
    matches: async pid => { inspected.push(pid); return pid === 10 || pid === 11; },
    observeWindow: async () => { throw Error('Child selection must not query the launcher window'); },
  }), 11);
  assert.deepEqual(inspected, [11]);
});

test('Firefox Windows discovery rejects unrelated processes and supports a direct window owner', async () => {
  const base = { platform: 'win32', parents: async () => [{ pid: 99, parentPid: 1 }], alive: () => false, matches: async pid => pid === 10 };
  assert.equal(await discoverGeckoBrowserPid('disposable-profile', [10], 500, { ...base, observeWindow: async () => null }), null);
  assert.equal(await discoverGeckoBrowserPid('disposable-profile', [10], 500, { ...base, observeWindow: async () => ({ width: 800 }) }), 10);
  assert.deepEqual(geckoDescendants([10], [{ pid: 11, parentPid: 10 }, { pid: 10, parentPid: 11 }]), [11]);
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
