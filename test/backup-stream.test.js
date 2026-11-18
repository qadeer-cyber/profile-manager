import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-stream-backup-'));
process.env.PM_DATA_DIR = dir;
const { db, userDataDir } = await import('../server/db.js');
const { createStreamedPortableBackup, spoolBackupUpload, processStreamedBackup } = await import('../server/backup-stream.js');
const { hashFileSync } = await import('../server/file-integrity.js');
const { restoreBackup } = await import('../server/backup.js');
after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); delete process.env.PM_DATA_DIR; });
const passphrase = 'disposable streaming passphrase';
function seed(bytes) {
  const id = randomUUID(), now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,created_at,updated_at) VALUES (?,?,?,?)').run(id, 'Stream fixture', now, now);
  const root = path.join(userDataDir(id), 'Default'); fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, 'large.bin'); fs.writeFileSync(file, 'fixture-start'); fs.truncateSync(file, bytes);
  return { id, file };
}
test('96 MiB encrypted export/restore uses bounded file reads and verifies the entire payload', { timeout: 30000 }, async () => {
  const { id, file } = seed(96 * 1024 * 1024), expected = hashFileSync(file);
  const original = fs.readFileSync; let exportFile, upload;
  fs.readFileSync = (target, ...args) => {
    if (typeof target === 'string' && fs.existsSync(target) && fs.statSync(target).isFile() && fs.statSync(target).size > 16 * 1024 * 1024) throw Error('Unbounded large-file read is forbidden');
    return original(target, ...args);
  };
  try {
    exportFile = await createStreamedPortableBackup(id, { passphrase, confirmSensitive: true });
    assert.ok(exportFile.size > 96 * 1024 * 1024);
    db.prepare('DELETE FROM profiles WHERE id=?').run(id); fs.rmSync(userDataDir(id), { recursive: true });
    upload = await spoolBackupUpload(fs.createReadStream(exportFile.file));
    const result = await processStreamedBackup(upload, { passphrase });
    assert.equal(result.added[0].id, id); assert.equal(hashFileSync(file), expected);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM pm_recovery_profile_locks').get().n, 0);
  } finally { fs.readFileSync = original; upload?.cleanup(); exportFile?.cleanup(); }
});
test('streamed small archives remain readable by the existing v2 buffer reader', async () => {
  const { id } = seed(1024); const transfer = await createStreamedPortableBackup(id, { passphrase, confirmSensitive: true });
  try {
    const bytes = fs.readFileSync(transfer.file);
    const result = restoreBackup(bytes, { passphrase, collision: 'rename' });
    assert.equal(result.renamed.length, 1);
  } finally { transfer.cleanup(); }
});
test('modified authenticated ciphertext never installs a profile and private spool is removable', async () => {
  const { id } = seed(1024), transfer = await createStreamedPortableBackup(id, { passphrase, confirmSensitive: true });
  let upload;
  try {
    const bytes = fs.readFileSync(transfer.file); bytes[bytes.length - 1] ^= 1;
    upload = await spoolBackupUpload(Readable.from([bytes]));
    const count = db.prepare('SELECT COUNT(*) n FROM profiles').get().n;
    await assert.rejects(() => processStreamedBackup(upload, { passphrase, collision: 'rename' }), e => e.code === 'INVALID_PASSPHRASE');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM profiles').get().n, count);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM pm_recovery_profile_locks').get().n, 0);
  } finally { upload?.cleanup(); transfer.cleanup(); }
});
test('truncated or corrupt containers fail safely with no live writes', async () => {
  for (const bytes of [Buffer.from('PMBE'), Buffer.from('not a backup')]) {
    const transfer = await spoolBackupUpload(Readable.from([bytes]));
    try { await assert.rejects(() => processStreamedBackup(transfer, { passphrase })); }
    finally { transfer.cleanup(); }
  }
});

test('bounded concurrent transfers and low-space refusal preserve existing profile files', async () => {
  const { id, file } = seed(1024), expected = hashFileSync(file);
  const first = await createStreamedPortableBackup(id, { passphrase, confirmSensitive: true });
  const second = await createStreamedPortableBackup(id, { passphrase, confirmSensitive: true });
  try { await assert.rejects(() => createStreamedPortableBackup(id, { passphrase, confirmSensitive: true }), e => e.code === 'BACKUP_TRANSFER_BUSY'); }
  finally { first.cleanup(); first.cleanup(); second.cleanup(); }
  const original = fs.statfsSync;
  try { fs.statfsSync = () => ({ bavail: 0, bsize: 4096 }); await assert.rejects(() => createStreamedPortableBackup(id, { passphrase, confirmSensitive: true }), e => e.code === 'BACKUP_DISK_SPACE'); }
  finally { fs.statfsSync = original; }
  assert.equal(hashFileSync(file), expected);
});

test('active transfer cannot be cleaned through recovery diagnostics', async () => {
  const { interruptedBackupTransfers, cleanupInterruptedBackupTransfer } = await import('../server/backup-stream.js');
  const { id } = seed(1024), transfer = await createStreamedPortableBackup(id, { passphrase, confirmSensitive: true });
  try {
    const item = interruptedBackupTransfers().find(item => item.id === path.basename(transfer.dir));
    assert.equal(item.state, 'active'); assert.equal(item.cleanupAllowed, false);
    assert.throws(() => cleanupInterruptedBackupTransfer(item.id), e => e.code === 'BACKUP_TRANSFER_BUSY');
  } finally { transfer.cleanup(); }
});

test('interrupted transfer is listed and requires explicit cleanup; corrupt ownership is retained', async () => {
  const { spawnSync } = await import('node:child_process');
  const { interruptedBackupTransfers, cleanupInterruptedBackupTransfer } = await import('../server/backup-stream.js');
  const env = { ...process.env, PM_DATA_DIR: dir }; delete env.NODE_TEST_CONTEXT;
  const script = "import {Readable} from 'node:stream';import {spoolBackupUpload} from './server/backup-stream.js';await spoolBackupUpload(Readable.from([Buffer.from('private interrupted fixture')]));process.exit(86);";
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, timeout: 10000 });
  assert.equal(result.status, 86);
  const item = interruptedBackupTransfers().find(item => item.state === 'interrupted'); assert.ok(item); assert.equal(item.cleanupAllowed, true);
  const ownerFile = path.join(dir, 'backup-transfers', item.id, 'owner.json'), owner = fs.readFileSync(ownerFile);
  fs.writeFileSync(ownerFile, '{broken');
  assert.equal(interruptedBackupTransfers().find(r => r.id === item.id).state, 'needs_review');
  assert.throws(() => cleanupInterruptedBackupTransfer(item.id), e => e.code === 'BACKUP_TRANSFER_BUSY');
  fs.writeFileSync(ownerFile, owner);
  assert.equal(cleanupInterruptedBackupTransfer(item.id).profileDataChanged, false);
  assert.equal(fs.existsSync(path.dirname(ownerFile)), false);
});

test('ordinary nested files named lock are preserved rather than treated as browser root locks', async () => {
  const { id } = seed(1024); fs.writeFileSync(path.join(userDataDir(id), 'Default', 'lock'), 'actual user file');
  const transfer = await createStreamedPortableBackup(id, { passphrase, confirmSensitive: true });
  let upload;
  try {
    upload = await spoolBackupUpload(fs.createReadStream(transfer.file));
    const result = await processStreamedBackup(upload, { passphrase, collision: 'rename' });
    assert.equal(fs.readFileSync(path.join(userDataDir(result.renamed[0].id), 'Default', 'lock'), 'utf8'), 'actual user file');
  } finally { upload?.cleanup(); transfer.cleanup(); }
});
