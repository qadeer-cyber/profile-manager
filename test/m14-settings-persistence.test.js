import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnServer, stopServer } from './_ports.mjs';

test('fingerprint and regional settings persist in SQLite across server restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m14-persist-'));
  const env = { ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'm14p' };
  const auth = { Authorization: 'Bearer m14p', 'Content-Type': 'application/json' };
  let proc = await spawnServer(env);
  try {
    const created = await fetch(proc.url + '/api/v1/profiles', {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        name: 'Persist',
        browserSettings: { locale: 'de-DE', timezoneId: 'Europe/Berlin', languages: ['de-DE'] },
        advancedSettings: { fingerprint: { webgl: 'restricted', fonts: 'restricted' } },
        webrtcSettings: { mode: 'disable_non_proxied_udp' },
      }),
    }).then(r => r.json());
    await stopServer(proc);
    proc = await spawnServer(env);
    const loaded = await fetch(proc.url + '/api/v1/profiles/' + created.id, { headers: auth }).then(r => r.json());
    assert.equal(loaded.browserSettings.timezoneId, 'Europe/Berlin');
    assert.equal(loaded.advancedSettings.fingerprint.webgl, 'restricted');
    assert.equal(loaded.webrtcSettings.mode, 'disable_non_proxied_udp');
  } finally {
    await stopServer(proc).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
