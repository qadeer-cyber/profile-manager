import './_isolated-data.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { buildFirefoxLaunchPlan } from '../server/browser-runtime/firefox-launch.js';
import { validateAdvancedSettings } from '../server/advanced-settings.js';

test('firefox launch plan applies 1366x768 window dimensions', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ff-win-'));
  process.env.PM_DATA_DIR = dataDir;
  const fakeExe = path.join(dataDir, 'firefox-stub.exe');
  fs.writeFileSync(fakeExe, '');
  const { setSetting, db } = await import('../server/db.js');
  setSetting('firefoxExecutablePath', fakeExe);
  const id = randomUUID();
  const dir = path.join(dataDir, 'profiles', id);
  fs.mkdirSync(dir, { recursive: true });
  const advancedSettings = validateAdvancedSettings({ screen: { preset: '1366x768' } });
  const plan = await buildFirefoxLaunchPlan({
    id,
    browserSettings: { locale: 'en-US', timezoneId: '', languages: ['en-US'] },
    advancedSettings,
  }, { userDataDir: dir, opts: { automation: false } });
  assert.ok(plan.args.includes('-width'));
  assert.ok(plan.args.includes('1366'));
  assert.ok(plan.args.includes('768'));
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.PM_DATA_DIR;
});
