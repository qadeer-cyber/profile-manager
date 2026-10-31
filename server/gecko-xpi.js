// Untrusted ZIP validation only. Signature metadata is never proof of Mozilla signing.
import { inflateRawSync } from 'node:zlib';
import { TextDecoder } from 'node:util';

export const XPI_LIMITS = Object.freeze({ archive: 32 * 1024 * 1024, entry: 16 * 1024 * 1024, total: 128 * 1024 * 1024, entries: 10000, manifest: 1024 * 1024 });
const invalid = message => Object.assign(new Error(`Invalid XPI: ${message}`), { status: 400, code: 'INVALID_XPI' });
const decoder = new TextDecoder('utf-8', { fatal: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function zipCrc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function safeName(bytes) {
  let name;
  try { name = decoder.decode(bytes); } catch { throw invalid('entry name is not UTF-8'); }
  const parts = name.replace(/\/$/, '').split('/');
  if (!name || name.length > 512 || /[\\:\u0000-\u001f\u007f]/.test(name) || parts.some(p =>
    !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) {
    throw invalid('unsafe entry path');
  }
  return name;
}

/** Validate the complete archive, including every member's bounded decompression and CRC. */
export function validateXpiArchive(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 22 || buf.length > XPI_LIMITS.archive) throw invalid('archive size exceeds limits or is truncated');
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50 && i + 22 + buf.readUInt16LE(i + 20) === buf.length) { end = i; break; }
  }
  if (end < 0) throw invalid('EOCD not found');
  const count = buf.readUInt16LE(end + 10), centralSize = buf.readUInt32LE(end + 12), centralStart = buf.readUInt32LE(end + 16);
  if (buf.readUInt16LE(end + 4) || buf.readUInt16LE(end + 6) || buf.readUInt16LE(end + 8) !== count ||
      !count || count > XPI_LIMITS.entries || centralStart + centralSize !== end) throw invalid('unsupported multi-disk, ZIP64, or malformed central directory');
  const entries = new Map(), names = new Set(), ranges = [];
  let off = centralStart, total = 0;
  for (let i = 0; i < count; i++) {
    if (off + 46 > end || buf.readUInt32LE(off) !== 0x02014b50) throw invalid('truncated central directory');
    const flags = buf.readUInt16LE(off + 8), method = buf.readUInt16LE(off + 10), crc = buf.readUInt32LE(off + 16);
    const packed = buf.readUInt32LE(off + 20), size = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28), extraLen = buf.readUInt16LE(off + 30), commentLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42), next = off + 46 + nameLen + extraLen + commentLen;
    if (next > end || buf.readUInt16LE(off + 34) || flags & ~0x080e || ![0, 8].includes(method)) throw invalid('unsupported encryption, flags, or compression');
    const unixType = (buf.readUInt32LE(off + 38) >>> 16) & 0xf000;
    if (unixType && unixType !== 0x8000 && unixType !== 0x4000) throw invalid('links and special files are forbidden');
    const nameBytes = buf.subarray(off + 46, off + 46 + nameLen), name = safeName(nameBytes);
    const canonical = name.replace(/\/$/, '').normalize('NFC').toLowerCase();
    if (names.has(canonical)) throw invalid('duplicate entry path');
    names.add(canonical);
    total += size;
    if (size > XPI_LIMITS.entry || total > XPI_LIMITS.total || (size > 1024 * 1024 && size > Math.max(packed, 1) * 200)) throw invalid('decompression limits exceeded');
    if (name === 'manifest.json' && size > XPI_LIMITS.manifest) throw invalid('manifest exceeds size limit');
    if (local + 30 > centralStart || buf.readUInt32LE(local) !== 0x04034b50 ||
        buf.readUInt16LE(local + 6) !== flags || buf.readUInt16LE(local + 8) !== method) throw invalid('invalid local header');
    const localNameLen = buf.readUInt16LE(local + 26), start = local + 30 + localNameLen + buf.readUInt16LE(local + 28);
    if (localNameLen !== nameLen || !buf.subarray(local + 30, local + 30 + localNameLen).equals(nameBytes) || start + packed > centralStart) throw invalid('local entry does not match central directory');
    let finish = start + packed;
    if (!(flags & 8)) {
      if (buf.readUInt32LE(local + 14) !== crc || buf.readUInt32LE(local + 18) !== packed || buf.readUInt32LE(local + 22) !== size) throw invalid('local entry sizes or CRC disagree');
    } else {
      if (finish + 12 > centralStart) throw invalid('truncated data descriptor');
      if (buf.readUInt32LE(finish) === 0x08074b50) finish += 4;
      if (finish + 12 > centralStart || buf.readUInt32LE(finish) !== crc || buf.readUInt32LE(finish + 4) !== packed || buf.readUInt32LE(finish + 8) !== size) throw invalid('invalid data descriptor');
      finish += 12;
    }
    ranges.push([local, finish]);
    let data;
    try { data = method === 0 ? Buffer.from(buf.subarray(start, start + packed)) : inflateRawSync(buf.subarray(start, start + packed), { maxOutputLength: Math.max(1, size) }); }
    catch { throw invalid('invalid or oversized compressed data'); }
    if (data.length !== size || zipCrc32(data) !== crc || (name.endsWith('/') && size !== 0)) throw invalid('entry size or CRC mismatch');
    entries.set(name, data);
    off = next;
  }
  if (off !== end) throw invalid('central directory length mismatch');
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges.some((range, i) => i && range[0] < ranges[i - 1][1])) throw invalid('overlapping entries');
  const directories = new Set([...entries.keys()].filter(n => n.endsWith('/')).map(n => n.slice(0, -1).normalize('NFC').toLowerCase()));
  for (const name of entries.keys()) {
    const parts = name.replace(/\/$/, '').split('/');
    while (parts.length > 1) {
      parts.pop();
      if (names.has(parts.join('/').normalize('NFC').toLowerCase()) && !directories.has(parts.join('/').normalize('NFC').toLowerCase())) throw invalid('file/directory collision');
    }
  }
  return entries;
}

export function listZipEntries(buffer) { return new Set(validateXpiArchive(buffer).keys()); }
export function readZipEntry(buffer, name) {
  const data = validateXpiArchive(buffer).get(name);
  if (!data) throw invalid(`entry not found: ${name}`);
  return data;
}
export function xpiHasMozillaSignatureMetadata(buffer) {
  const entries = validateXpiArchive(buffer);
  return entries.has('META-INF/mozilla.rsa') || entries.has('META-INF/mozilla.sf');
}
