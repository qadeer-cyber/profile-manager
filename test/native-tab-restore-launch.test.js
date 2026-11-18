import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildProfileLaunchPlan } from '../server/browser-runtime/launch-plan.js';
import { nativeArgv } from '../server/browser-runtime/native-chromium.js';
import { writeSavedTabs, chooseLaunchUrls } from '../server/tab-restore.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-restore-plan-'));
process.env.PM_DATA_DIR = dataDir;
const { db, setSetting } = await import('../server/db.js');
const { chromium } = await import('playwright');
let exe;
try { exe = chromium.executablePath(); } catch { exe = process.execPath; }
setSetting('executablePath', exe);

after(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.PM_DATA_DIR;
});

function profileWithRestore(name, { writeTabs } = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const advanced = JSON.stringify({ preferences: { restoreTabs: true, startupUrls: [], permissions: {} } });
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,advanced_settings,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, name, '[]', '', '', advanced, now, now);
  const p = db.prepare('SELECT * FROM profiles WHERE id=?').get(id);
  p.advancedSettings = JSON.parse(p.advanced_settings);
  p.browserSettings = {};
  p.webrtcSettings = { mode: 'browser_default' };
  p.proxy = null;
  const dir = path.join(dataDir, 'profiles', id);
  fs.mkdirSync(dir, { recursive: true });
  if (writeTabs) writeSavedTabs(dir, writeTabs);
  return { p, dir };
}

test('chooseLaunchUrls prefers startup URLs over saved tabs', () => {
  const urls = chooseLaunchUrls({
    startupUrls: ['https://startup.example/'],
    savedUrls: ['https://saved.example/'],
  });
  assert.deepEqual(urls, ['https://startup.example/']);
});

test('native manual launch plan opens saved tabs when restoreTabs is opt-in', async () => {
  const { p, dir } = profileWithRestore('restore', { writeTabs: ['https://restore-tabs.example/path'] });
  const plan = await buildProfileLaunchPlan(p, { userDataDir: dir, automation: false, headless: false });
  assert.equal(plan.restoreTabs, true);
  assert.equal(plan.runtime, 'native');
  assert.ok(plan.openUrls.includes('https://restore-tabs.example/path'));
  const argv = nativeArgv({ dir: plan.dir, args: plan.args, openUrls: plan.openUrls, restoreTabs: plan.restoreTabs });
  assert.ok(argv.includes('https://restore-tabs.example/path'));
  assert.equal(argv.includes('--restore-last-session'), false);
});

test('native launch uses restore-last-session when opt-in and no eligible URLs', async () => {
  const { p, dir } = profileWithRestore('restore-empty');
  const plan = await buildProfileLaunchPlan(p, { userDataDir: dir, automation: false, headless: false });
  const argv = nativeArgv({ dir: plan.dir, args: plan.args, openUrls: plan.openUrls, restoreTabs: plan.restoreTabs });
  assert.ok(argv.includes('--restore-last-session'));
});
