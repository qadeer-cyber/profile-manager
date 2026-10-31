// Real Chromium process check. This confirms launch arguments, not that WebRTC is leak-proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnServer, stopServer } from './_ports.mjs';
import { summarizeWebRtcArguments } from '../server/diagnostic-process.js';

test('launched profiles carry only their own WebRTC policy and enabled extensions', { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m4-browser-'));
  const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm4-browser-test' };
  let srv;
  const ids = [];
  function unpacked(name) {
    const root = path.join(dir, 'src', name);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ manifest_version: 3, name, version: '1.0.0', permissions: ['storage'] }));
    fs.writeFileSync(path.join(root, 'worker.js'), '/* fixture */\n');
    return root;
  }
  async function api(method, url, body) {
    const r = await fetch(srv.url + '/api/v1' + url, { method, headers: { Authorization: 'Bearer m4-browser-test', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    const value = text ? JSON.parse(text) : null;
    assert.equal(r.status, method === 'DELETE' ? 204 : (method === 'POST' && url.includes('/import') ? 201 : r.status));
    if (!r.ok) assert.fail(JSON.stringify(value));
    return value;
  }
  function argv(pid) {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0+$/, '').split('\0');
  }
  try {
    srv = await spawnServer(env);
    const notes = await api('POST', '/extensions/import', { path: unpacked('Notes') });
    const ads = await api('POST', '/extensions/import', { path: unpacked('Ads') });
    const alpha = await api('POST', '/profiles', {
      name: 'Policy',
      webrtcSettings: { mode: 'disable_non_proxied_udp' },
      extensionAssignments: [{ extensionId: notes.id, enabled: true }, { extensionId: ads.id, enabled: false }],
    });
    const bravo = await api('POST', '/profiles', {
      name: 'Plain',
      webrtcSettings: { mode: 'browser_default' },
      extensionAssignments: [{ extensionId: ads.id, enabled: true }],
    });
    ids.push(alpha.id, bravo.id);
    const launchedA = await api('POST', `/profiles/${alpha.id}/launch`, { headless: true, automation: true });
    const launchedB = await api('POST', `/profiles/${bravo.id}/launch`, { headless: true, automation: true });
    assert.ok(launchedA.pid && launchedB.pid && launchedA.pid !== launchedB.pid);
    const argsA = argv(launchedA.pid);
    const argsB = argv(launchedB.pid);
    assert.deepEqual(summarizeWebRtcArguments(argsA), { kind: 'present', value: 'disable_non_proxied_udp' });
    assert.deepEqual(summarizeWebRtcArguments(argsB), { kind: 'absent' });
    const notesDir = path.join(dir, 'extensions', notes.id);
    const adsDir = path.join(dir, 'extensions', ads.id);
    const loadA = argsA.find(flag => flag.startsWith('--load-extension='));
    const loadB = argsB.find(flag => flag.startsWith('--load-extension='));
    assert.ok(loadA && loadA.includes(notesDir), loadA);
    assert.equal(loadA.includes(adsDir), false);
    assert.equal(argsA.includes('--disable-extensions'), false);
    assert.ok(loadB && loadB.includes(adsDir) && !loadB.includes(notesDir), loadB);
    const prefs = JSON.parse(fs.readFileSync(path.join(dir, 'profiles', alpha.id, 'Default', 'Preferences'), 'utf8'));
    assert.equal(prefs.webrtc.ip_handling_policy, 'disable_non_proxied_udp');
  } finally {
    for (const id of ids) { try { await fetch(srv.url + `/api/v1/profiles/${id}/stop`, { method: 'POST', headers: { Authorization: 'Bearer m4-browser-test', 'Content-Type': 'application/json' }, body: '{}' }); } catch {} }
    if (srv) await stopServer(srv);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});