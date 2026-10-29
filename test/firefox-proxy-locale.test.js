import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildFirefoxLaunchPlan } from '../server/browser-runtime/firefox-launch.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ff-prefs-'));
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

test('firefox launch writes HTTP proxy and locale prefs to user.js', async () => {
  const id = randomUUID();
  const dir = path.join(dataDir, 'profiles', id);
  fs.mkdirSync(dir, { recursive: true });
  const p = {
    id,
    browserSettings: { locale: 'de-DE', timezoneId: '', languages: ['de-DE', 'en-US'] },
    proxy: { type: 'http', host: 'proxy.example', port: 8080, username: '', password: '' },
  };
  const plan = await buildFirefoxLaunchPlan(p, { userDataDir: dir, opts: { automation: false } });
  const userJs = fs.readFileSync(path.join(plan.profileDir, 'user.js'), 'utf8');
  assert.match(userJs, /network\.proxy\.http", "proxy\.example"/);
  assert.match(userJs, /network\.proxy\.http_port", 8080/);
  assert.match(userJs, /network\.proxy\.ssl", "proxy\.example"/);
  assert.match(userJs, /intl\.accept_languages", "de-DE,en-US"/);
  assert.match(userJs, /intl\.locale\.requested", "de-DE"/);
  assert.ok(plan.args.includes('-lang'));
});

test('firefox launch writes SOCKS5 prefs when proxy type is socks5', async () => {
  const id = randomUUID();
  const dir = path.join(dataDir, 'profiles', id);
  fs.mkdirSync(dir, { recursive: true });
  const p = {
    id,
    browserSettings: { locale: '', timezoneId: '', languages: [] },
    proxy: { type: 'socks5', host: '10.0.0.5', port: 1080, username: '', password: '' },
  };
  const plan = await buildFirefoxLaunchPlan(p, { userDataDir: dir, opts: { automation: false } });
  const userJs = fs.readFileSync(path.join(plan.profileDir, 'user.js'), 'utf8');
  assert.match(userJs, /network\.proxy\.socks", "10\.0\.0\.5"/);
  assert.match(userJs, /network\.proxy\.socks_port", 1080/);
  assert.match(userJs, /network\.proxy\.socks_version", 5/);
});
