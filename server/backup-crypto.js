// Optional authenticated backup envelope.
//
// Algorithm: AES-256-GCM (authenticated encryption). A wrong passphrase or any
// modified byte fails authentication. The passphrase is the UTF-8 scrypt password
// and is never written to the file, logs, or error messages by this module.
//
// KDF: scrypt, fixed parameters so a hostile file cannot request an expensive
// derivation. N=16384, r=8, p=1, key length 32 bytes, salt 16 random bytes.
// Node's crypto.scryptSync is used. maxmem is 64 MiB.
//
// Layout (big-endian), all of the header is AES-GCM additional data:
//   0..3    magic "PMBE"
//   4       version = 1
//   5       kdf id = 1 (scrypt)
//   6..7    flags = 0
//   8..23   salt (16)
//   24..27  scrypt N = 16384
//   28..31  scrypt r = 8
//   32..35  scrypt p = 1
//   36..47  AES-GCM IV (12)
//   48..63  AES-GCM authentication tag (16)
//   64..end ciphertext (the existing PMB1 archive)
//
// Older backups start with "PMB1" and stay readable without a passphrase.
import crypto from 'crypto';

export const BACKUP_CRYPTO = Object.freeze({
  magic: 'PMBE',
  version: 1,
  algorithm: 'AES-256-GCM',
  kdf: Object.freeze({ name: 'scrypt', id: 1, N: 16384, r: 8, p: 1, keyLen: 32, saltLen: 16, maxmem: 64 * 1024 * 1024 }),
  ivLen: 12,
  tagLen: 16,
  headerLen: 48,
});

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

export function isEncryptedBackup(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === BACKUP_CRYPTO.magic;
}

export function assertBackupPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 8 || passphrase.length > 1024) {
    throw fail(400, 'Passphrase must be 8 to 1024 characters', 'INVALID_PASSPHRASE');
  }
  return passphrase;
}

export function readBackupHeader(buffer, { headerOnly = false } = {}) {
  if (!isEncryptedBackup(buffer) || buffer.length < BACKUP_CRYPTO.headerLen + BACKUP_CRYPTO.tagLen + (headerOnly ? 0 : 1)) {
    throw fail(400, 'Encrypted backup header is invalid', 'CORRUPT_BACKUP');
  }
  const version = buffer.readUInt8(4);
  const kdf = buffer.readUInt8(5);
  const flags = buffer.readUInt16BE(6);
  const N = buffer.readUInt32BE(24);
  const r = buffer.readUInt32BE(28);
  const p = buffer.readUInt32BE(32);
  const { kdf: params } = BACKUP_CRYPTO;
  if (version !== 1 || kdf !== params.id || flags !== 0 || N !== params.N || r !== params.r || p !== params.p) {
    throw fail(400, 'Encrypted backup uses an unsupported algorithm or KDF', 'UNSUPPORTED_BACKUP');
  }
  return {
    header: buffer.subarray(0, BACKUP_CRYPTO.headerLen),
    salt: buffer.subarray(8, 24),
    iv: buffer.subarray(36, 48),
    tag: buffer.subarray(48, 64),
    ciphertext: buffer.subarray(64),
  };
}

export function deriveBackupKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, BACKUP_CRYPTO.kdf.keyLen, {
    N: BACKUP_CRYPTO.kdf.N,
    r: BACKUP_CRYPTO.kdf.r,
    p: BACKUP_CRYPTO.kdf.p,
    maxmem: BACKUP_CRYPTO.kdf.maxmem,
  });
}

export function createBackupHeader() {
  const salt = crypto.randomBytes(BACKUP_CRYPTO.kdf.saltLen);
  const iv = crypto.randomBytes(BACKUP_CRYPTO.ivLen);
  const header = Buffer.alloc(BACKUP_CRYPTO.headerLen);
  header.write(BACKUP_CRYPTO.magic, 0, 'ascii');
  header.writeUInt8(BACKUP_CRYPTO.version, 4);
  header.writeUInt8(BACKUP_CRYPTO.kdf.id, 5);
  header.writeUInt16BE(0, 6);
  salt.copy(header, 8);
  header.writeUInt32BE(BACKUP_CRYPTO.kdf.N, 24);
  header.writeUInt32BE(BACKUP_CRYPTO.kdf.r, 28);
  header.writeUInt32BE(BACKUP_CRYPTO.kdf.p, 32);
  iv.copy(header, 36);
  return { header, salt, iv };
}

export function encryptBackup(plain, passphrase) {
  if (!Buffer.isBuffer(plain) || !plain.length) throw fail(400, 'Backup is empty', 'CORRUPT_BACKUP');
  assertBackupPassphrase(passphrase);
  const { header, salt, iv } = createBackupHeader();
  const key = deriveBackupKey(passphrase, salt);
  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(header);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([header, tag, ciphertext]);
  } finally {
    key.fill(0);
  }
}

export function decryptBackup(buffer, passphrase) {
  assertBackupPassphrase(passphrase);
  const parts = readBackupHeader(buffer);
  const key = deriveBackupKey(passphrase, parts.salt);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, parts.iv);
    decipher.setAAD(parts.header);
    decipher.setAuthTag(parts.tag);
    return Buffer.concat([decipher.update(parts.ciphertext), decipher.final()]);
  } catch {
    throw fail(400, 'Passphrase was rejected or the encrypted backup was modified', 'INVALID_PASSPHRASE');
  } finally {
    key.fill(0);
  }
}

export function describeEncryptedBackup() {
  return {
    format: 'profile-manager-backup-encrypted',
    version: BACKUP_CRYPTO.version,
    algorithm: BACKUP_CRYPTO.algorithm,
    kdf: { name: 'scrypt', N: BACKUP_CRYPTO.kdf.N, r: BACKUP_CRYPTO.kdf.r, p: BACKUP_CRYPTO.kdf.p, keyLen: BACKUP_CRYPTO.kdf.keyLen },
    requiresPassphrase: true,
  };
}
