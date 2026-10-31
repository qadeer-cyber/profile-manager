import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decryptBackup, encryptBackup } from '../server/backup-crypto.js';
import { unpackArchive, packArchive } from '../server/archive.js';
import { archive, sandbox, run, passphrase } from './_portable-recovery-helpers.mjs';
for (const boundary of ['purge-parked', 'purge-before-delete', 'purge-after-delete', 'purge-committed']) {
  test(`interrupted purge at ${boundary} never automatically retries destruction`, t => {
    const root = sandbox(t), dir = path.join(root, 'purge'), ids = run(dir, { mode: 'seed' }).value;
    run(dir, { mode: 'purge', crash: boundary }, 86);
    const before = run(dir, { mode: 'status' }).value;
    run(dir, { mode: 'startup' }); run(dir, { mode: 'startup' });
    const after = run(dir, { mode: 'status' }).value;
    assert.deepEqual(after.profiles, before.profiles);
    if (boundary !== 'purge-committed') {
      const recovered = run(dir, { mode: 'recover', profileId: ids.chromium }).value[0];
      assert.equal(recovered.remainingDataRecovered, true);
      assert.equal(recovered.verified, boundary !== 'purge-after-delete');
    } else assert.equal(after.profiles.some(p => p.id === ids.chromium), false);
  });
}
test('partial Windows-style EBUSY purge preserves remaining data for manual recovery and backup replacement', t => {
  const { b, file, ids } = archive(t); run(b, { mode: 'seed', label: 'Previous' });
  assert.equal(run(b, { mode: 'purge', partial: true }, 1).code, 'PURGE_FS_FAILED');
  run(b, { mode: 'startup' });
  const recovered = run(b, { mode: 'recover', profileId: ids.chromium }).value[0];
  assert.equal(recovered.verified, false);
  assert.equal(run(b, { mode: 'recover', profileId: ids.chromium }).value[0].verified, false);
  let p = run(b, { mode: 'status' }).value.profiles.find(p => p.id === ids.chromium);
  assert.match(p.purge_error, /incomplete/); assert.equal(p.localStorage, 'Previous chromium');
  run(b, { mode: 'restore', file, collision: 'replace' });
  p = run(b, { mode: 'status' }).value.profiles.find(p => p.id === ids.chromium);
  assert.equal(p.marker, 'Export chromium'); assert.equal(p.purge_error, null);
});
test('SQLite purge error retains the trash row and explicit retry is idempotent', t => {
  const root = sandbox(t), dir = path.join(root, 'purge'), ids = run(dir, { mode: 'seed' }).value;
  assert.equal(run(dir, { mode: 'purge', dbFail: true }, 1).code, 'PURGE_FS_FAILED');
  const status = run(dir, { mode: 'status' }).value;
  assert.ok(status.profiles.find(p => p.id === ids.chromium).deleted_at);
  run(dir, { mode: 'purge' });
  assert.equal(run(dir, { mode: 'status' }).value.profiles.some(p => p.id === ids.chromium), false);
});

