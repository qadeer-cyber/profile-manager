import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { launchRuntimeMode, buildProfileLaunchPlan } from '../server/browser-runtime/launch-plan.js';
import { assertNativeLaunchArgs, nativeArgv } from '../server/browser-runtime/native-chromium.js';
import { browserEngineArchitectureReport } from '../server/browser-runtime/index.js';

test('manual profile start selects native runtime by default', () => {
  assert.equal(launchRuntimeMode({ automation: false, headless: false }), 'native');
  assert.equal(launchRuntimeMode({ automation: true, headless: false }), 'playwright');
  assert.equal(launchRuntimeMode({ automation: true, headless: false }, 'firefox'), 'native');
  assert.equal(launchRuntimeMode({ automation: false, headless: true }), 'playwright');
});

test('native argv excludes Playwright automation switches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-native-'));
  const argv = nativeArgv({
    dir,
    args: ['--lang=en-US', '--disable-extensions-except=/tmp/x'],
    openUrls: ['https://example.com/'],
  });
  assert.ok(argv.some(a => a.startsWith('--user-data-dir=')));
  assert.equal(argv.includes('--remote-debugging-pipe'), false);
  assert.equal(argv.includes('--enable-automation'), false);
  assertNativeLaunchArgs(argv);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('native argv uses restore-last-session when restoreTabs and no URLs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-native-'));
  const argv = nativeArgv({ dir, args: [], openUrls: [], restoreTabs: true });
  assert.ok(argv.includes('--restore-last-session'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('architecture report documents native manual path', () => {
  const r = browserEngineArchitectureReport();
  assert.equal(r.manualBrowsingRequiresPlaywright, false);
  assert.equal(r.layers.browserRuntime.manual.includes('native'), true);
});

test('launch plan for clean profile uses extension-free args', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-plan-'));
  process.env.PM_DATA_DIR = dataDir;
  const { db, setSetting } = await import('../server/db.js');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, 't', '[]', '', '', now, now);
  const { chromium } = await import('playwright');
  let exe;
  try { exe = chromium.executablePath(); } catch { exe = process.execPath; }
  setSetting('executablePath', exe);
  const p = db.prepare('SELECT * FROM profiles WHERE id=?').get(id);
  p.proxy = null;
  const dir = path.join(dataDir, 'profiles', id);
  fs.mkdirSync(dir, { recursive: true });
  const plan = await buildProfileLaunchPlan(p, { userDataDir: dir, automation: false, headless: false });
  assert.equal(plan.runtime, 'native');
  assert.ok(plan.playwrightOpts.ignoreDefaultArgs?.includes('--disable-extensions'));
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.PM_DATA_DIR;
});
