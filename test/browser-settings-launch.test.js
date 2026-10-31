// Launch-boundary tests use a stub browser. They do not claim Chromium behavior.
import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m3-launch-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_MANUAL_LAUNCH_RUNTIME = 'playwright';
const calls = [];
mock.module(new URL('../node_modules/playwright/index.mjs', import.meta.url).href, { namedExports: { chromium: {
  launchPersistentContext: async (dir, opts) => { calls.push({ dir, opts }); throw new Error('intentional launch boundary'); },
} } });
const { db, setSetting } = await import('../server/db.js');
const { launch } = await import('../server/browsers.js');
setSetting('executablePath', process.execPath);
after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
test('locale/timezone propagate; automation remains off and failed launch releases lock', async () => {
  const id = randomUUID();
  await assert.rejects(launch({ id, browserSettings: { locale: 'de-DE', timezoneId: 'Europe/Berlin', languages: [] } }, { headless: true, automation: false }), /intentional launch boundary/);
  const opts = calls.at(-1).opts;
  assert.equal(opts.locale, 'de-DE'); assert.equal(opts.timezoneId, 'Europe/Berlin');
  assert.equal(opts.handleSIGTERM, false); assert.equal(opts.handleSIGINT, false);
  assert.ok(!opts.args.some(a => a.startsWith('--remote-debugging-port')));
  assert.ok(!fs.existsSync(path.join(dir, 'profiles', id, '.pm-lock')));
});
test('ordered languages use native Chromium flags and avoid single-language override', async () => {
  await assert.rejects(launch({ id: randomUUID(), browserSettings: { locale: 'en-US', timezoneId: 'UTC', languages: ['en-US', 'ur-PK'] } }, { automation: false }), /intentional launch boundary/);
  const opts = calls.at(-1).opts;
  assert.equal(opts.locale, undefined); assert.equal(opts.timezoneId, 'UTC');
  assert.ok(opts.args.includes('--accept-lang=en-US,ur-PK')); assert.ok(opts.args.includes('--lang=en-US'));
});
test('host defaults add no regional overrides; invalid settings never reach Chromium', async () => {
  await assert.rejects(launch({ id: randomUUID() }, { automation: false }), /intentional launch boundary/);
  assert.equal(calls.at(-1).opts.locale, undefined); assert.equal(calls.at(-1).opts.timezoneId, undefined);
  assert.deepEqual(calls.at(-1).opts.args, []);
  const n = calls.length;
  await assert.rejects(launch({ id: randomUUID(), browserSettings: { timezoneId: 'invalid' } }), e => e.status === 400);
  assert.equal(calls.length, n);
});
