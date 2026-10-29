import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { buildFirefoxLaunchPlan } from '../server/browser-runtime/firefox-launch.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ff-obs-'));
process.env.PM_DATA_DIR = dataDir;
const fakeExe = path.join(dataDir, 'firefox-stub.exe');
fs.writeFileSync(fakeExe, '');
const { setSetting, db } = await import('../server/db.js');
setSetting('firefoxExecutablePath', fakeExe);

after(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.PM_DATA_DIR;
});

test('Firefox launch plan exposes TZ env and user.js locale/timezone observables', async () => {
  const id = randomUUID();
  const dir = path.join(dataDir, 'profiles', id);
  fs.mkdirSync(dir, { recursive: true });
  const p = {
    id,
    browserSettings: { locale: 'de-DE', timezoneId: 'Europe/Berlin', languages: ['de-DE', 'en-US'] },
    proxy: null,
    webrtcSettings: { mode: 'browser_default' },
  };
  const plan = await buildFirefoxLaunchPlan(p, { userDataDir: dir, opts: { automation: false } });
  assert.equal(plan.timezoneId, 'Europe/Berlin');
  assert.ok(plan.args.includes('-lang'));
  const userJs = fs.readFileSync(path.join(plan.profileDir, 'user.js'), 'utf8');
  assert.match(userJs, /intl\.accept_languages", "de-DE,en-US"/);
  assert.match(userJs, /privacy\.timezone\.override", "Europe\/Berlin"/);
  assert.match(userJs, /network\.proxy\.type", 0/);
});

test('Firefox proxy then direct relaunch updates observable prefs', async () => {
  const id = randomUUID();
  const dir = path.join(dataDir, 'profiles', id);
  fs.mkdirSync(dir, { recursive: true });
  const p = {
    id,
    browserSettings: { locale: 'en-US', timezoneId: 'America/Chicago', languages: ['en-US'] },
    proxy: { type: 'http', host: 'relay.test', port: 3128, username: '', password: '' },
    webrtcSettings: { mode: 'browser_default' },
  };
  await buildFirefoxLaunchPlan(p, { userDataDir: dir, opts: { automation: false } });
  let userJs = fs.readFileSync(path.join(dir, 'gecko', 'user.js'), 'utf8');
  assert.match(userJs, /network\.proxy\.type", 1/);
  p.proxy = null;
  const plan = await buildFirefoxLaunchPlan(p, { userDataDir: dir, opts: { automation: false } });
  assert.equal(plan.timezoneId, 'America/Chicago');
  userJs = fs.readFileSync(path.join(plan.profileDir, 'user.js'), 'utf8');
  assert.match(userJs, /network\.proxy\.type", 0/);
  assert.doesNotMatch(userJs, /network\.proxy\.http", "relay\.test"/);
});
