import './_isolated-data.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { geckoWebRtcUserPrefLines, geckoTimezoneUserPrefLine, geckoTimezoneEnv } from '../server/firefox-gecko-prefs.js';
import { buildFirefoxLaunchPlan } from '../server/browser-runtime/firefox-launch.js';

test('gecko WebRTC prefs map restrictive Chromium modes to ICE prefs', () => {
  assert.deepEqual(geckoWebRtcUserPrefLines({ mode: 'browser_default' }), []);
  const lines = geckoWebRtcUserPrefLines({ mode: 'disable_non_proxied_udp' });
  assert.ok(lines.some(l => l.includes('media.peerconnection.ice.proxy_only')));
  assert.ok(lines.some(l => l.includes('media.peerconnection.ice.no_host')));
});

test('gecko timezone helpers emit override pref and TZ env', () => {
  assert.equal(geckoTimezoneEnv(''), null);
  assert.equal(geckoTimezoneEnv('Europe/Berlin'), 'Europe/Berlin');
  assert.match(geckoTimezoneUserPrefLine('Europe/Berlin'), /privacy\.timezone\.override", "Europe\/Berlin"/);
});

test('firefox launch plan writes WebRTC and timezone prefs', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ff-wrtc-'));
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
    browserSettings: { locale: 'en-US', timezoneId: 'America/Chicago', languages: ['en-US'] },
    webrtcSettings: { mode: 'disable_non_proxied_udp' },
    proxy: null,
  };
  const plan = await buildFirefoxLaunchPlan(p, { userDataDir: dir, opts: { automation: false } });
  assert.equal(plan.timezoneId, 'America/Chicago');
  const userJs = fs.readFileSync(path.join(plan.profileDir, 'user.js'), 'utf8');
  assert.match(userJs, /privacy\.timezone\.override/);
  assert.match(userJs, /media\.peerconnection\.ice\.proxy_only/);
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.PM_DATA_DIR;
});
