import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decryptBackup, encryptBackup } from '../server/backup-crypto.js';
import { unpackArchive, packArchive } from '../server/archive.js';
import { archive, sandbox, run, passphrase } from './_portable-recovery-helpers.mjs';
for (const boundary of ['journal-created', 'staged-file:0:Default/marker', 'prepared', 'park:0', 'install:0', 'park:1', 'install:1', 'before-db-commit', 'after-db-commit', 'before-cleanup', 'after-cleanup']) {
  test(`process interruption at ${boundary} recovers idempotently with database/filesystem agreement`, t => {
    const { b, file, ids } = archive(t); run(b, { mode: 'seed', label: 'Previous' });
    run(b, { mode: 'restore', file, collision: 'replace', crash: boundary }, 86);
    run(b, { mode: 'startup' }); run(b, { mode: 'startup' });
    const committed = ['after-db-commit', 'before-cleanup', 'after-cleanup'].includes(boundary);
    let status = run(b, { mode: 'status' }).value;
    const p = status.profiles.find(p => p.id === ids.chromium);
    assert.equal(p.name, (committed ? 'Export' : 'Previous') + ' chromium');
    assert.equal(p.marker, (committed ? 'Export' : 'Previous') + ' chromium');
    assert.equal(p.proxySecretMatches, true);
    if (committed && boundary !== 'after-cleanup') { assert.equal(p.blocked, true); run(b, { mode: 'recover', cleanup: true }); }
    status = run(b, { mode: 'status' }).value; assert.equal(status.locks.length, 0);
  });
}
