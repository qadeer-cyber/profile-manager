import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadUpdate } from '../electron/update-download.js';

const bytes = Buffer.from('controlled installer fixture');
const asset = {
  download: 'https://github.com/qadeer-cyber/profile-manager/releases/download/azwah-v0.5.0-beta.2/Azwah-Setup-x64.exe',
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
};
test('only complete verified bytes are exposed as an installer', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'azwah-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const bad of [Buffer.alloc(bytes.length), bytes.subarray(1), Buffer.concat([bytes, bytes])]) {
    await assert.rejects(downloadUpdate(asset, { directory, fetchAsset: async () => new Response(bad) }));
    assert.deepEqual(await readdir(directory), []);
  }
  const seen = [];
  const path = await downloadUpdate(asset, { directory, fetchAsset: async () => new Response(bytes), progress: n => seen.push(n) });
  assert.equal(seen.at(-1), bytes.length);
  assert.deepEqual(await readFile(path), bytes);
});
test('rejects untrusted redirects and cleans up cancelled downloads', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'azwah-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(downloadUpdate(asset, { directory, fetchAsset: async () => Response.redirect('https://example.test/installer') }), /redirect/);
  const controller = new AbortController();
  await assert.rejects(downloadUpdate(asset, { directory, signal: controller.signal, fetchAsset: async () => {
    controller.abort();
    return new Response(bytes);
  } }));
  assert.deepEqual(await readdir(directory), []);
});
