// Minimal ZIP reader for Firefox .xpi (manifest + signature metadata only).
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

function u16(buf, off) { return buf.readUInt16LE(off); }
function u32(buf, off) { return buf.readUInt32LE(off); }

export function listZipEntries(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const names = new Set();
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 65557; i--) {
    if (u32(buf, i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('invalid zip: EOCD not found');
  const centralCount = u16(buf, eocd + 10);
  let off = u32(buf, eocd + 16);
  for (let i = 0; i < centralCount; i++) {
    if (u32(buf, off) !== SIG_CENTRAL) break;
    const nameLen = u16(buf, off + 28);
    const extra = u16(buf, off + 30);
    const comment = u16(buf, off + 32);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    names.add(name.replace(/\\/g, '/'));
    off += 46 + nameLen + extra + comment;
  }
  return names;
}

export function readZipEntry(buffer, entryName) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const want = String(entryName).replace(/\\/g, '/');
  let off = 0;
  while (off + 30 <= buf.length) {
    if (u32(buf, off) !== SIG_LOCAL) break;
    const comp = u16(buf, off + 8);
    const compSize = u32(buf, off + 18);
    const nameLen = u16(buf, off + 26);
    const extraLen = u16(buf, off + 28);
    const name = buf.subarray(off + 30, off + 30 + nameLen).toString('utf8').replace(/\\/g, '/');
    const dataStart = off + 30 + nameLen + extraLen;
    if (name === want) {
      const payload = buf.subarray(dataStart, dataStart + compSize);
      if (comp !== 0) throw new Error(`zip entry ${want} is compressed (store-only XPI expected in tests)`);
      return payload;
    }
    off = dataStart + compSize;
  }
  throw new Error(`zip entry not found: ${want}`);
}

export function xpiHasMozillaSignature(buffer) {
  const names = listZipEntries(buffer);
  return names.has('META-INF/mozilla.rsa') || names.has('META-INF/mozilla.sf');
}
