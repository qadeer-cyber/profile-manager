// Launch-boundary tests use a stub browser. Argument checks use the same parser as process inspection.
import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m4-launch-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_MANUAL_LAUNCH_RUNTIME = 'playwright';
const calls = [];
mock.module(new URL('../node_modules/playwright/index.mjs', import.meta.url).href, { namedExports: { chromium: {
  launchPersistentContext: async (userDir, opts) => { calls.push({ userDir, opts }); throw new Error('intentional launch boundary'); },
} } });
const { db, setSetting, userDataDir } = await import('../server/db.js');
const { launch } = await import('../server/browsers.js');
const { summarizeWebRtcArguments } = await import('../server/diagnostic-process.js');
setSetting('executablePath', process.execPath);
after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function profile() {
  const id = randomUUID(), now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, 'WebRTC boundary fixture', '[]', '', '', now, now);
  return id;
}

test('browser default adds no flag and does not rewrite preferences', async () => {
  const id = profile();
  const pref = path.join(userDataDir(id), 'Default', 'Preferences');
  fs.mkdirSync(path.dirname(pref), { recursive: true });
  fs.writeFileSync(pref, JSON.stringify({ profile: { exit_type: 'Normal' }, webrtc: { ip_handling_policy: 'leave-me' } }));
  await assert.rejects(launch({ id, webrtcSettings: { mode: 'browser_default' }, browserSettings: { locale: '', timezoneId: '', languages: [] } }, { automation: false }), /intentional launch boundary/);
  assert.deepEqual(calls.at(-1).opts.args, []);
  // Restored extensions must remain usable; this is separate from WebRTC policy.
  assert.deepEqual(calls.at(-1).opts.ignoreDefaultArgs, ['--disable-extensions']);
  assert.deepEqual(summarizeWebRtcArguments(calls.at(-1).opts.args), { kind: 'absent' });
  assert.equal(JSON.parse(fs.readFileSync(pref, 'utf8')).webrtc.ip_handling_policy, 'leave-me');
  assert.equal(JSON.parse(fs.readFileSync(pref, 'utf8')).profile.exit_type, 'Normal');
});

test('restrictive policy is one verified flag and a merged preference', async () => {
  const id = profile();
  const pref = path.join(userDataDir(id), 'Default', 'Preferences');
  fs.mkdirSync(path.dirname(pref), { recursive: true });
  fs.writeFileSync(pref, JSON.stringify({ profile: { exit_type: 'Normal' } }));
  await assert.rejects(launch({
    id,
    browserSettings: { locale: 'en-US', timezoneId: 'UTC', languages: ['en-US', 'ur-PK'] },
    webrtcSettings: { mode: 'disable_non_proxied_udp' },
  }, { automation: false }), /intentional launch boundary/);
  const args = calls.at(-1).opts.args;
  assert.ok(args.includes('--accept-lang=en-US,ur-PK'));
  assert.deepEqual(summarizeWebRtcArguments(args), { kind: 'present', value: 'disable_non_proxied_udp' });
  assert.equal(args.filter(flag => flag.includes('force-webrtc-ip-handling-policy')).length, 1);
  const saved = JSON.parse(fs.readFileSync(pref, 'utf8'));
  assert.equal(saved.profile.exit_type, 'Normal');
  assert.equal(saved.webrtc.ip_handling_policy, 'disable_non_proxied_udp');
});

test('explicit Chromium default is distinct from omitting the flag', async () => {
  await assert.rejects(launch({ id: profile(), webrtcSettings: { mode: 'default' } }, { automation: false }), /intentional launch boundary/);
  assert.deepEqual(summarizeWebRtcArguments(calls.at(-1).opts.args), { kind: 'present', value: 'default' });
});

test('unsupported WebRTC settings never reach Chromium', async () => {
  const n = calls.length;
  await assert.rejects(launch({ id: profile(), webrtcSettings: { mode: 'disabled' } }), e => e.status === 400 && e.code === 'INVALID_WEBRTC_SETTINGS');
  assert.equal(calls.length, n);
});
