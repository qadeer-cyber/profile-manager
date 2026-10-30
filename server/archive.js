// Length-prefixed backup container. Paths are checked before a single byte is
// written, checksums are verified, and symlinks are not representable.
import crypto from 'crypto';

const MAGIC = Buffer.from('PMB1');
const MAX_FILES = 10000;
const MAX_FILE = 32 * 1024 * 1024;
const MAX_TOTAL = 64 * 1024 * 1024;
const bad = message => Object.assign(new Error(message), { status: 400, code: 'UNSAFE_ARCHIVE' });

export function assertArchivePath(value) {
  if (typeof value !== 'string' || !value || value.length > 512) throw bad('Backup path is not allowed');
  if (value.includes('\0') || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) throw bad('Backup path is not allowed');
  const segments = value.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.length > 255 || /[:]/.test(segment) || /[. ]$/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment) || /[\u0000-\u001f\u007f]/.test(segment))) throw bad('Backup path is not allowed');
  if (value === 'profiles.db' || value === 'secret.key' || value === 'meta.json') return value;
  const id = segments[1];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if ((segments[0] === 'profiles' || segments[0] === 'extensions') && uuid.test(id || '')) return value;
  throw bad('Backup path is not allowed');
}

function u16(value) { const buffer = Buffer.alloc(2); buffer.writeUInt16BE(value); return buffer; }
function u32(value) { const buffer = Buffer.alloc(4); buffer.writeUInt32BE(value); return buffer; }
function u64(value) { const buffer = Buffer.alloc(8); buffer.writeBigUInt64BE(BigInt(value)); return buffer; }

export function packArchive(files) {
  if (!Array.isArray(files) || files.length > MAX_FILES) throw bad('Backup has too many files');
  let total = 0;
  const parts = [MAGIC, u32(1), u32(files.length)];
  for (const file of files) {
    const rel = assertArchivePath(file.path);
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    if (data.length > MAX_FILE) throw bad('A backup file is too large');
    total += data.length;
    if (total > MAX_TOTAL) throw bad('Backup is too large');
    const encoded = Buffer.from(rel, 'utf8');
    if (encoded.length > 1024) throw bad('Backup path is not allowed');
    parts.push(u16(encoded.length), encoded, u64(data.length), data, crypto.createHash('sha256').update(data).digest());
  }
  return Buffer.concat(parts);
}

export function unpackArchive(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || !buffer.subarray(0, 4).equals(MAGIC)) throw bad('Backup archive is corrupt');
  let offset = 4;
  const read = size => {
    if (offset + size > buffer.length) throw bad('Backup archive is corrupt');
    const slice = buffer.subarray(offset, offset + size);
    offset += size;
    return slice;
  };
  const version = read(4).readUInt32BE(0);
  if (version !== 1) throw bad('Unsupported backup version');
  const count = read(4).readUInt32BE(0);
  if (count > MAX_FILES) throw bad('Backup has too many files');
  const files = [];
  let total = 0;
  const seen = new Set();
  for (let index = 0; index < count; index += 1) {
    const pathLength = read(2).readUInt16BE(0);
    const rel = assertArchivePath(read(pathLength).toString('utf8'));
    const canonical = rel.normalize('NFC').toLowerCase();
    if (seen.has(canonical)) throw bad('Backup archive repeats a path');
    seen.add(canonical);
    const size = Number(read(8).readBigUInt64BE(0));
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE) throw bad('A backup file is too large');
    total += size;
    if (total > MAX_TOTAL) throw bad('Backup is too large');
    const data = read(size);
    const hash = read(32);
    if (!crypto.createHash('sha256').update(data).digest().equals(hash)) throw bad('Backup checksum does not match');
    files.push({ path: rel, data: Buffer.from(data) });
  }
  if (offset !== buffer.length) throw bad('Backup archive has trailing data');
  return files;
}
