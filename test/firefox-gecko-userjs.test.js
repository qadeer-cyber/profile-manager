import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildManagedGeckoPrefLines, writeManagedGeckoUserJs, PM_GECKO_BEGIN, splitGeckoUserJs } from '../server/firefox-gecko-userjs.js';
import { buildFirefoxLaunchPlan } from '../server/browser-runtime/firefox-launch.js';

test('managed block replaces proxy prefs on direct relaunch', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ff-uj-'));
  process.env.PM_DATA_DIR = dataDir;
  const fakeExe = path.join(dataDir, 'firefox-stub.exe');
  fs.writeFileSync(fakeExe, '');
  const { setSetting, db } = await import('../server/db.js');
  setSetting('firefoxExecutablePath', fakeExe);
  const id = randomUUID();
  const dir = path.join(dataDir, 'profiles', id);
  fs.mkdirSync(dir, { recursive: true });
  const p = {
    id,
    browserSettings: { locale: 'en-US', timezoneId: '', languages: ['en-US'] },
    proxy: { type: 'http', host: 'proxy.test', port: 8080, username: '', password: '' },
    webrtcSettings: { mode: 'browser_default' },
  };
  await buildFirefoxLaunchPlan(p, { userDataDir: dir, opts: { automation: false } });
  const profileDir = path.join(dir, 'gecko');
  let userJs = fs.readFileSync(path.join(profileDir, 'user.js'), 'utf8');
  assert.match(userJs, /network\.proxy\.type", 1/);
  p.proxy = null;
  await buildFirefoxLaunchPlan(p, { userDataDir: dir, opts: { automation: false } });
  userJs = fs.readFileSync(path.join(profileDir, 'user.js'), 'utf8');
  assert.equal((userJs.match(/network\.proxy\.type", 1/g) || []).length, 0);
  assert.match(userJs, /network\.proxy\.type", 0/);
  assert.equal(splitGeckoUserJs(userJs).before.includes(PM_GECKO_BEGIN), false);
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.PM_DATA_DIR;
});

test('buildManagedGeckoPrefLines is deterministic for same input', () => {
  const input = { proxy: null, relayUrl: null, regional: { languages: ['en-US'], locale: 'en-US', timezoneId: 'UTC' }, webrtcSettings: { mode: 'disable_non_proxied_udp' } };
  const a = buildManagedGeckoPrefLines(input).join('\n');
  const b = buildManagedGeckoPrefLines(input).join('\n');
  assert.equal(a, b);
});
