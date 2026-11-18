import { deflateRawSync } from 'node:zlib';
import { zipCrc32 } from '../server/gecko-xpi.js';

// Structurally valid test ZIPs, never claimed to be signed Firefox packages.
export function buildXpi(files, { deflate = false, descriptor = false } = {}) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const data = Buffer.from(value), nameBytes = Buffer.from(name), packed = deflate ? deflateRawSync(data) : data;
    const crc = zipCrc32(data), flags = 0x800 | (descriptor ? 8 : 0), method = deflate ? 8 : 0;
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    if (!descriptor) { local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); }
    local.writeUInt16LE(nameBytes.length, 26); nameBytes.copy(local, 30);
    const tail = descriptor ? Buffer.alloc(16) : Buffer.alloc(0);
    if (descriptor) { tail.writeUInt32LE(0x08074b50); tail.writeUInt32LE(crc, 4); tail.writeUInt32LE(packed.length, 8); tail.writeUInt32LE(data.length, 12); }
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42); nameBytes.copy(central, 46);
    locals.push(local, packed, tail); centrals.push(central); offset += local.length + packed.length + tail.length;
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(centrals.length, 8); end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(centrals.reduce((n, b) => n + b.length, 0), 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
export const demoManifest = JSON.stringify({ manifest_version: 2, name: 'Fixture', version: '1.0', browser_specific_settings: { gecko: { id: 'demo@test' } } });
