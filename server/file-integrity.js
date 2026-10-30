import fs from 'node:fs';
import crypto from 'node:crypto';

// Fixed-size buffers: hashing a browser database never allocates its full size.
export function hashFileSync(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('Expected a regular file');
    const hash = crypto.createHash('sha256'), chunk = Buffer.allocUnsafe(128 * 1024);
    let bytes = 0, size;
    while ((size = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) { bytes += size; hash.update(chunk.subarray(0, size)); }
    if (bytes !== stat.size || fs.fstatSync(fd).size !== stat.size) throw new Error('File changed during integrity verification');
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}
