// Milestone D: the shipping update checker and downloader, run against a local release feed.
// Only the transport is substituted; selectUpdate and downloadUpdate validation run unchanged.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createUpdateChecker } from '../electron/release-updates.js';
import { downloadUpdate } from '../electron/update-download.js';
import { loopbackUpdateTransport } from '../electron/update-test-transport.js';
import { startUpdateFeed, sha256File } from '../scripts/update-feed-fixture.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-update-e2e-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const installer = path.join(dir, 'Azwah-Setup-x64.exe');
fs.writeFileSync(installer, randomBytes(3 * 1024 * 1024 + 17));

test('transport maps only the two pinned GitHub URLs to a loopback origin', async () => {
  for (const bad of ['http://localhost:9', 'http://10.0.0.1:80', 'https://127.0.0.1:9', 'http://127.0.0.1:0', 'http://127.0.0.1:70000', 'http://127.0.0.1:9/x', null])
    assert.throws(() => loopbackUpdateTransport(bad), /127\.0\.0\.1/, String(bad));
  const seen = [];
  const t = loopbackUpdateTransport('http://127.0.0.1:4567', { fetchImpl: async url => { seen.push(url); return 'ok'; } });
  await t('https://api.github.com/repos/qadeer-cyber/profile-manager/releases?per_page=100');
  await t(new URL('https://github.com/qadeer-cyber/profile-manager/releases/download/azwah-v2.0.0-beta.2/Azwah-Setup-x64.exe'));
  assert.deepEqual(seen, ['http://127.0.0.1:4567/releases', 'http://127.0.0.1:4567/download/azwah-v2.0.0-beta.2/Azwah-Setup-x64.exe']);
  for (const other of ['https://api.github.com/repos/someone/else/releases?per_page=100', 'https://github.com/qadeer-cyber/profile-manager/releases/download/azwah-v2/Other.exe', 'https://release-assets.githubusercontent.com/x', 'https://example.com/'])
    await assert.rejects(t(other), /refused/);
});

test('beta A finds beta B, downloads it and verifies size and SHA-256', async () => {
  const feed = await startUpdateFeed({ installer, version: '2.0.0-beta.2', previous: '2.0.0-beta.1' });
  try {
    const transport = loopbackUpdateTransport(feed.origin);
    const checker = createUpdateChecker({ version: '2.0.0-beta.1', channel: 'beta', fetchRelease: transport });
    const state = await checker.check();
    assert.equal(state.status, 'available');
    assert.equal(state.latest.version, '2.0.0-beta.2');
    assert.equal(state.latest.sha256, feed.sha256);
    assert.equal(state.latest.size, feed.size);
    let progress = 0;
    const file = await downloadUpdate(state.latest, { fetchAsset: transport, directory: dir, progress: n => { progress = n; } });
    assert.equal(path.basename(file), 'Azwah-Setup-x64.exe');
    assert.equal(await sha256File(file), feed.sha256);
    assert.equal(progress, feed.size);
    assert.deepEqual(feed.requests, ['/releases', `/download/${feed.tag}/Azwah-Setup-x64.exe`]);
    const stable = await createUpdateChecker({ version: '2.0.0-beta.1', channel: 'stable', fetchRelease: transport }).check();
    assert.equal(stable.status, 'current', 'stable channel ignores beta releases');
    const newer = await createUpdateChecker({ version: '2.0.0-beta.2', channel: 'beta', fetchRelease: transport }).check();
    assert.equal(newer.status, 'current', 'B does not offer itself');
  } finally { await feed.close(); }
});

test('a release whose published digest does not match the bytes is refused and leaves no file', async () => {
  const feed = await startUpdateFeed({ installer, version: '2.0.0-beta.2', tamper: true });
  try {
    const transport = loopbackUpdateTransport(feed.origin);
    const state = await createUpdateChecker({ version: '2.0.0-beta.1', channel: 'beta', fetchRelease: transport }).check();
    assert.equal(state.status, 'available');
    const before = fs.readdirSync(dir).filter(name => name.startsWith('azwah-update-')).length;
    await assert.rejects(downloadUpdate(state.latest, { fetchAsset: transport, directory: dir }), /integrity/);
    assert.equal(fs.readdirSync(dir).filter(name => name.startsWith('azwah-update-')).length, before, 'partial download removed');
  } finally { await feed.close(); }
});
