import { isAlive } from './proc.js';
// Disk-backed portable PMBE/PMB1 transport. No unauthenticated plaintext reaches live profiles.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DATA_DIR } from './db.js';
import { createBackupHeader, deriveBackupKey, readBackupHeader, assertBackupPassphrase } from './backup-crypto.js';
import { assertArchivePath } from './archive.js';
import { createPortableDescriptors, restorePortableV2, validatePortableV2 } from './portable-backup.js';
import { inspectBackup, restoreBackup } from './backup.js';

export const STREAM_BACKUP_LIMITS = Object.freeze({ file: 4 * 1024 ** 3, payload: 8 * 1024 ** 3, container: 9 * 1024 ** 3, files: 100000, manifest: 16 * 1024 * 1024, chunk: 128 * 1024 });
const bad = message => Object.assign(new Error(message), { status: 400, code: 'UNSAFE_ARCHIVE' });
let activeTransfers = 0;
const activeDirectories = new Set();
const DISK_RESERVE = 256 * 1024 * 1024;
function ensureDisk(bytes = 0) {
  const st = fs.statfsSync(DATA_DIR);
  if (Number(st.bavail) * Number(st.bsize) < bytes + DISK_RESERVE) throw Object.assign(new Error('Insufficient free disk space for a safe backup transfer'), { status: 507, code: 'BACKUP_DISK_SPACE' });
}
function temporary() {
  if (activeTransfers >= 2) throw Object.assign(new Error('Two backup transfers are already active; retry after they finish'), { status: 409, code: 'BACKUP_TRANSFER_BUSY' });
  ensureDisk();
  const root = path.join(DATA_DIR, 'backup-transfers');
  if (fs.lstatSync(DATA_DIR).isSymbolicLink() || (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink())) throw bad('Backup transfer storage must not be a symlink');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const dir = fs.mkdtempSync(path.join(root, 'transfer-'));
  fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), version: 1 }), { flag: 'wx', mode: 0o600 });
  activeDirectories.add(dir); activeTransfers++; let cleaned = false;
  return { dir, cleanup: () => {
    if (cleaned) return;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    cleaned = true; activeDirectories.delete(dir); activeTransfers--;
  } };
}
const number = (size, value) => { const b = Buffer.alloc(size); if (size === 2) b.writeUInt16BE(value); else if (size === 4) b.writeUInt32BE(value); else b.writeBigUInt64BE(BigInt(value)); return b; };
async function* archiveChunks(meta, files) {
  const manifest = Buffer.from(JSON.stringify(meta));
  if (manifest.length > STREAM_BACKUP_LIMITS.manifest || files.length + 1 > STREAM_BACKUP_LIMITS.files) throw bad('Portable metadata exceeds limits');
  yield Buffer.concat([Buffer.from('PMB1'), number(4, 1), number(4, files.length + 1)]);
  let total = 0;
  for (const file of [{ path: 'meta.json', data: manifest }, ...files]) {
    assertArchivePath(file.path);
    const name = Buffer.from(file.path), size = file.source ? file.size : file.data.length;
    total += size;
    if (name.length > 1024 || size > STREAM_BACKUP_LIMITS.file || total > STREAM_BACKUP_LIMITS.payload) throw bad('Portable payload exceeds limits');
    yield Buffer.concat([number(2, name.length), name, number(8, size)]);
    const hash = crypto.createHash('sha256'); let bytes = 0;
    if (file.source) {
      const st = fs.lstatSync(file.source);
      if (!st.isFile() || st.isSymbolicLink() || st.size !== size) throw bad('Export source changed');
      for await (const chunk of fs.createReadStream(file.source, { highWaterMark: STREAM_BACKUP_LIMITS.chunk, flags: fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) })) {
        bytes += chunk.length; if (bytes > size) throw bad('Export source grew during reading'); hash.update(chunk); yield chunk;
      }
    } else { bytes = file.data.length; hash.update(file.data); yield file.data; }
    const digest = hash.digest();
    if (bytes !== size || (file.sha256 && digest.toString('hex') !== file.sha256)) throw bad('Export source changed during encryption');
    yield digest;
  }
}

export async function createStreamedPortableBackup(profileId, options) {
  if (activeTransfers >= 2) throw Object.assign(new Error('Two backup transfers are already active'), { status: 409, code: 'BACKUP_TRANSFER_BUSY' });
  const { meta, files } = createPortableDescriptors(profileId, options);
  ensureDisk(files.reduce((n, f) => n + f.size, 0));
  const tmp = temporary(), file = path.join(tmp.dir, 'export.pmp');
  const { header, salt, iv } = createBackupHeader();
  let key;
  try {
    key = deriveBackupKey(options.passphrase, salt);
    fs.writeFileSync(file, Buffer.concat([header, Buffer.alloc(16)]), { flag: 'wx', mode: 0o600 });
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(header);
    await pipeline(Readable.from(archiveChunks(meta, files)), cipher, fs.createWriteStream(file, { flags: 'r+', start: 64 }));
    const fd = fs.openSync(file, 'r+');
    try { fs.writeSync(fd, cipher.getAuthTag(), 0, 16, 48); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return { ...tmp, file, size: fs.statSync(file).size };
  } catch (error) { tmp.cleanup(); throw error; }
  finally { key?.fill(0); }
}

export async function spoolBackupUpload(input) {
  const tmp = temporary(), file = path.join(tmp.dir, 'upload.pmp'); let bytes = 0;
  let nextDiskCheck = 0;
  const cap = new Transform({ transform(chunk, encoding, callback) {
    try { bytes += chunk.length; if (bytes > STREAM_BACKUP_LIMITS.container) throw bad('Backup upload exceeds 9 GiB limit');
      if (bytes >= nextDiskCheck) { ensureDisk(); nextDiskCheck = bytes + 16 * 1024 * 1024; } callback(null, chunk);
    } catch (error) { callback(error); }
  } });
  try { await pipeline(input, cap, fs.createWriteStream(file, { flags: 'wx', mode: 0o600 })); return { ...tmp, file, size: bytes }; }
  catch (error) { tmp.cleanup(); throw error; }
}
async function decryptToPrivateFile(input, output, passphrase) {
  assertBackupPassphrase(passphrase);
  const source = await fsp.open(input, 'r');
  let key;
  try {
    const header = Buffer.alloc(64), read = await source.read(header, 0, 64, 0);
    if (read.bytesRead !== 64) throw bad('Encrypted backup header is truncated');
    const parts = readBackupHeader(header, { headerOnly: true });
    key = deriveBackupKey(passphrase, parts.salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, parts.iv);
    decipher.setAAD(parts.header); decipher.setAuthTag(parts.tag);
    try { await pipeline(fs.createReadStream(input, { start: 64, highWaterMark: STREAM_BACKUP_LIMITS.chunk }), decipher, fs.createWriteStream(output, { flags: 'wx', mode: 0o600 })); }
    catch { throw Object.assign(new Error('Passphrase was rejected or the encrypted backup was modified'), { status: 400, code: 'INVALID_PASSPHRASE' }); }
  } finally { await source.close(); key?.fill(0); }
}
async function unpackPrivateFile(file, dir) {
  const handle = await fsp.open(file, 'r'), size = (await handle.stat()).size;
  let offset = 0;
  const read = async count => {
    if (!Number.isSafeInteger(count) || count < 0 || offset + count > size) throw bad('Truncated backup archive');
    const data = Buffer.alloc(count); let done = 0;
    while (done < count) { const r = await handle.read(data, done, count - done, offset + done); if (!r.bytesRead) throw bad('Truncated backup archive'); done += r.bytesRead; }
    offset += count; return data;
  };
  try {
    if ((await read(4)).toString() !== 'PMB1' || (await read(4)).readUInt32BE() !== 1) throw bad('Unsupported backup container');
    const count = (await read(4)).readUInt32BE();
    if (!count || count > STREAM_BACKUP_LIMITS.files) throw bad('Backup entry count exceeds limits');
    const seen = new Set(), files = []; let total = 0;
    const chunk = Buffer.allocUnsafe(STREAM_BACKUP_LIMITS.chunk);
    for (let i = 0; i < count; i++) {
      const length = (await read(2)).readUInt16BE(); if (!length || length > 1024) throw bad('Invalid archive path length');
      const rel = assertArchivePath((await read(length)).toString('utf8')), canonical = rel.normalize('NFC').toLowerCase();
      if (seen.has(canonical)) throw bad('Backup repeats a path'); seen.add(canonical);
      const bytes = Number((await read(8)).readBigUInt64BE()); total += bytes;
      if (!Number.isSafeInteger(bytes) || bytes > STREAM_BACKUP_LIMITS.file || total > STREAM_BACKUP_LIMITS.payload || offset + bytes + 32 > size || (rel === 'meta.json' && bytes > STREAM_BACKUP_LIMITS.manifest)) throw bad('Archive member exceeds limits or is truncated');
      const dest = path.join(dir, `entry-${i}`), out = await fsp.open(dest, 'wx', 0o600), hash = crypto.createHash('sha256'); let left = bytes;
      try {
        while (left) {
          const n = Math.min(left, chunk.length); let got = 0;
          while (got < n) { const r = await handle.read(chunk, got, n - got, offset + got); if (!r.bytesRead) throw bad('Truncated backup data'); got += r.bytesRead; }
          offset += n; left -= n; hash.update(chunk.subarray(0, n));
          let written = 0; while (written < n) written += (await out.write(chunk, written, n - written)).bytesWritten;
        }
        await out.sync();
      } finally { await out.close(); }
      const expected = await read(32), digest = hash.digest(); if (!digest.equals(expected)) throw bad('Archive member checksum mismatch');
      files.push({ path: rel, source: dest, size: bytes, sha256: digest.toString('hex') });
    }
    if (offset !== size) throw bad('Archive has trailing bytes');
    const manifest = files.find(f => f.path === 'meta.json'); if (!manifest) throw bad('Backup manifest is missing');
    let meta; try { meta = JSON.parse(await fsp.readFile(manifest.source, 'utf8')); } catch { throw bad('Backup manifest is corrupt'); }
    return { meta, files };
  } finally { await handle.close(); }
}

/** Caller owns an authenticated encrypted upload in an application-owned private spool directory. */
export async function processStreamedBackup(spool, { passphrase, collision = 'abort', running = [], profileIds, inspect = false, fault } = {}) {
  const head = Buffer.alloc(4), fd = await fsp.open(spool.file, 'r');
  try { await fd.read(head, 0, 4, 0); } finally { await fd.close(); }
  if (head.toString() !== 'PMBE') {
    if (spool.size > 64 * 1024 * 1024) throw bad('Legacy plaintext backup exceeds its supported limit');
    const bytes = await fsp.readFile(spool.file); return inspect ? inspectBackup(bytes, { passphrase }) : restoreBackup(bytes, { passphrase, collision, running, profileIds, fault });
  }
  ensureDisk(3 * spool.size);
  const plain = path.join(spool.dir, 'authenticated.pmb');
  await decryptToPrivateFile(spool.file, plain, passphrase);
  const { meta, files } = await unpackPrivateFile(plain, spool.dir);
  if (meta?.format !== 'profile-manager-profile-backup' || meta.version !== 2) {
    if (spool.size > 64 * 1024 * 1024) throw bad('Legacy backup exceeds its supported limit');
    const bytes = await fsp.readFile(spool.file); return inspect ? inspectBackup(bytes, { passphrase }) : restoreBackup(bytes, { passphrase, collision, running, profileIds, fault });
  }
  validatePortableV2(files, meta, { encrypted: true });
  if (inspect) return { encrypted: true, format: meta.format, version: 2, schemaVersion: meta.schemaVersion, profiles: meta.profiles, fileChecksumCount: files.length - 1, containsDatabase: false, requiresPassphrase: true };
  if (!['abort', 'rename', 'replace'].includes(collision)) throw bad('Invalid restore collision strategy');
  const onlyIds = profileIds == null ? null : new Set(Array.isArray(profileIds) ? profileIds : String(profileIds).split(','));
  return restorePortableV2(files, meta, { encrypted: true, collision, running, onlyIds, fault });
}

function transferDirectory(name) {
  if (typeof name !== 'string' || !/^transfer-[a-zA-Z0-9]+$/.test(name)) throw bad('Invalid transfer identity');
  const root = path.join(DATA_DIR, 'backup-transfers'), dir = path.join(root, name);
  if (fs.lstatSync(DATA_DIR).isSymbolicLink() || fs.lstatSync(root).isSymbolicLink() || fs.lstatSync(dir).isSymbolicLink()) throw bad('Unsafe transfer storage');
  return dir;
}
export function interruptedBackupTransfers() {
  const root = path.join(DATA_DIR, 'backup-transfers');
  if (!fs.existsSync(root)) return [];
  if (fs.lstatSync(root).isSymbolicLink()) return [{ id: 'storage', state: 'needs_review', cleanupAllowed: false }];
  return fs.readdirSync(root).filter(name => /^transfer-[a-zA-Z0-9]+$/.test(name)).map(id => {
    try {
      const dir = transferDirectory(id), file = path.join(dir, 'owner.json');
      if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 1024) throw bad('Invalid transfer ownership');
      const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (owner.version !== 1 || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw bad('Invalid transfer owner');
      const active = activeDirectories.has(dir) || isAlive(owner.pid);
      return { id, state: active ? 'active' : 'interrupted', cleanupAllowed: !active, createdAt: owner.createdAt };
    } catch { return { id, state: 'needs_review', cleanupAllowed: false }; }
  });
}
export function cleanupInterruptedBackupTransfer(id) {
  const item = interruptedBackupTransfers().find(item => item.id === id);
  if (!item || !item.cleanupAllowed) throw Object.assign(new Error('Transfer is active or ownership needs manual review; files were retained'), { status: 409, code: 'BACKUP_TRANSFER_BUSY' });
  fs.rmSync(transferDirectory(id), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  return { id, state: 'cleaned', profileDataChanged: false };
}
