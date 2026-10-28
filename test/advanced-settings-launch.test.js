import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'node:crypto';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m6-launch-'));
process.env.PM_DATA_DIR = dir;
const calls = [];
mock.module(new URL('../node_modules/playwright/index.mjs', import.meta.url).href, { namedExports: { chromium: {
  launchPersistentContext: async (userDir, opts) => { calls.push({ userDir, opts }); throw new Error('intentional launch boundary'); },
  executablePath: () => process.execPath,
} } });
const { db, setSetting, userDataDir } = await import('../server/db.js');
const { launch } = await import('../server/browsers.js');
const { MANIFEST } = await import('../server/chromium.js');
setSetting('executablePath', process.execPath);
after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const base = { browserSettings: { locale: '', timezoneId: '', languages: [] }, webrtcSettings: { mode: 'browser_default' } };
function prefs(id) {
  const file = path.join(userDataDir(id), 'Default', 'Preferences');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ profile: { exit_type: 'Normal' }, webrtc: { ip_handling_policy: 'leave-me' } }));
  return file;
}
test('default advanced settings add no arguments and do not rewrite preferences', async () => {
  const id = randomUUID();
  const file = prefs(id);
  await assert.rejects(launch({ id, ...base }, { automation: false }), /intentional launch boundary/);
  assert.deepEqual(calls.at(-1).opts.args, []);
  assert.equal(calls.at(-1).opts.userAgent, undefined);
  assert.equal(calls.at(-1).opts.viewport, null);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.profile.exit_type, 'Normal');
  assert.equal(saved.webrtc.ip_handling_policy, 'leave-me');
  assert.equal(saved.profile.default_content_setting_values, undefined);
});
test('a coherent full user agent and window preset reach Chromium with the real version', async () => {
  const id = randomUUID();
  const file = prefs(id);
  await assert.rejects(launch({ id, ...base, advancedSettings: {
    userAgent: { mode: 'full' },
    screen: { preset: '1280x800', deviceScaleFactor: 2 },
    geolocation: { permission: 'deny', latitude: null, longitude: null, accuracy: null },
    preferences: { startupUrls: [], permissions: { notifications: 'deny', microphone: 'default', camera: 'default', clipboard: 'ask', midi: 'default' } },
  } }, { automation: false, headless: false }), /intentional launch boundary/);
  const opts = calls.at(-1).opts;
  assert.match(opts.userAgent, new RegExp(`Chrome/${MANIFEST.browserVersion.replace(/\./g, '\\.')}`));
  assert.doesNotMatch(opts.userAgent, /HeadlessChrome/);
  assert.deepEqual(opts.viewport, { width: 1280, height: 800 });
  assert.ok(opts.args.includes('--window-size=1280,800'));
  assert.ok(opts.args.includes('--force-device-scale-factor=2'));
  assert.equal(opts.permissions, undefined);
  const spoof = opts.args.join(' ');
  assert.doesNotMatch(spoof, /hardware-concurrency|device-memory|fingerprint|use-fake-device/i);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.profile.exit_type, 'Normal');
  assert.equal(saved.profile.default_content_setting_values.geolocation, 2);
  assert.equal(saved.profile.default_content_setting_values.notifications, 2);
  assert.equal(saved.profile.default_content_setting_values.clipboard, 3);
});
test('invalid advanced settings never reach Chromium', async () => {
  const before = calls.length;
  await assert.rejects(launch({ id: randomUUID(), ...base, advancedSettings: { userAgent: { mode: 'Chrome/99.0.0.0' } } }), error => error.code === 'INVALID_ADVANCED_SETTINGS');
  assert.equal(calls.length, before);
});
