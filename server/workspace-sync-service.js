// Optional self-hosted ciphertext relay. It never receives a backup passphrase.
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Database from 'better-sqlite3';
import { readBackupHeader } from './backup-crypto.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const error = (status, message) => Object.assign(Error(message), { status });
const digest = token => crypto.createHash('sha256').update(token).digest('hex');
export function createWorkspaceSyncService({ directory, key, cert, principals, maxBytes = 9 * 1024 ** 3, quotaBytes = 18 * 1024 ** 3 }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 64 || maxBytes > 9 * 1024 ** 3 || !Number.isSafeInteger(quotaBytes) || quotaBytes < maxBytes) throw Error('Invalid bounded sync storage limits');
  if (!Array.isArray(principals) || !principals.length || principals.some(p => !/^[0-9a-f]{64}$/.test(p.tokenSha256) || !p.workspaces || Object.entries(p.workspaces).some(([id, role]) => !UUID.test(id) || !['reader','writer'].includes(role)))) throw Error('Explicit per-device hashed tokens and workspace roles are required');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink()) throw Error('Sync directory must not be a symlink');
  const db = new Database(path.join(directory, 'sync.db')); db.pragma('journal_mode = WAL'); db.pragma('synchronous = FULL');
  db.exec('CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, object TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL)');
  let active = 0, reserved = 0;
  const uploads = new Set();
  // Interrupted ciphertext uploads also consume quota. They are retained for
  // explicit review, never silently retried or deleted at service startup.
  const usage = () => fs.readdirSync(directory).filter(f => /^[0-9a-f-]{36}\.pmp(?:\.upload)?$/.test(f) && !uploads.has(f)).reduce((n, f) => {
    const st = fs.lstatSync(path.join(directory, f)); if (!st.isFile() || st.isSymbolicLink()) throw error(409, 'Sync storage requires review'); return n + st.size;
  }, 0);
  const server = https.createServer({ key, cert, minVersion: 'TLSv1.2', requestTimeout: 300000, headersTimeout: 15000 }, async (req, res) => {
    let tmp, uploadName, reservation = 0, counted = false, stage = 'request';
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      const match = /^\/v1\/workspaces\/([^/?]+)\/snapshot$/.exec(req.url);
      const token = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(req.headers.authorization || '')?.[1];
      const presented = Buffer.from(digest(token || ''), 'hex');
      const principal = principals.find(p => crypto.timingSafeEqual(presented, Buffer.from(p.tokenSha256, 'hex')));
      if (!token || !principal) throw error(401, 'Authentication required');
      if (!match || !UUID.test(match[1])) throw error(404, 'Not found');
      const id = match[1], role = principal.workspaces[id];
      if (!role || (req.method === 'PUT' && role !== 'writer')) throw error(403, 'Workspace access denied');
      if (!['GET','PUT'].includes(req.method)) throw error(405, 'Method not allowed');
      if (active >= 2) throw error(429, 'Transfer capacity reached');
      active++; counted = true;
      if (req.method === 'GET') {
        const row = db.prepare('SELECT * FROM snapshots WHERE id=?').get(id); if (!row) throw error(404, 'Snapshot not found');
        if (!/^[0-9a-f-]{36}\.pmp$/.test(row.object)) throw error(409, 'Stored snapshot metadata needs recovery');
        const file = path.join(directory, row.object); const st = fs.lstatSync(file);
        if (!st.isFile() || st.isSymbolicLink() || st.size !== row.size) throw error(409, 'Stored snapshot needs recovery');
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': row.size, ETag: `"${row.revision}"`, 'X-Content-SHA256': row.sha256, 'Cache-Control': 'no-store' });
        await pipeline(fs.createReadStream(file), res); return;
      }
      const expected = /^"(0|[1-9]\d{0,12})"$/.exec(req.headers['if-match'] || '')?.[1];
      if (expected === undefined) throw error(428, 'If-Match revision is required');
      const size = Number(req.headers['content-length']);
      if (!Number.isSafeInteger(size) || size < 64 || size > maxBytes || usage() + reserved + size > quotaBytes) throw error(413, 'Snapshot size or storage quota exceeded');
      const object = crypto.randomUUID() + '.pmp'; tmp = path.join(directory, object + '.upload');
      uploadName = object + '.upload'; uploads.add(uploadName); reservation = size; reserved += size;
      const hash = crypto.createHash('sha256'); let bytes = 0, header = Buffer.alloc(0);
      const cap = new Transform({ transform(chunk, enc, callback) {
        bytes += chunk.length; if (bytes > size) return callback(error(413, 'Snapshot exceeds declared size'));
        if (header.length < 64) header = Buffer.concat([header, chunk.subarray(0, 64 - header.length)]);
        hash.update(chunk); callback(null, chunk);
      } });
      stage = 'upload';
      await pipeline(req, cap, fs.createWriteStream(tmp, { flags: 'wx', mode: 0o600 }));
      if (bytes !== size) throw error(400, 'Truncated snapshot');
      try { readBackupHeader(header, { headerOnly: true }); } catch { throw error(400, 'Only encrypted PMBE snapshots are accepted'); }
      const sha256 = hash.digest('hex');
      stage = 'flush';
      // Windows FlushFileBuffers requires a handle opened for writing.
      const fd = fs.openSync(tmp, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      let revision;
      stage = 'commit';
      db.transaction(() => {
        const row = db.prepare('SELECT revision FROM snapshots WHERE id=?').get(id);
        if ((row?.revision || 0) !== Number(expected)) throw error(409, 'Snapshot changed; pull and resolve the conflict explicitly');
        if (usage() + reserved > quotaBytes) throw error(413, 'Snapshot storage quota exceeded');
        fs.renameSync(tmp, path.join(directory, object)); tmp = null;
        if (process.platform !== 'win32') { const d = fs.openSync(directory, 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); } }
        revision = Number(expected) + 1;
        db.prepare('INSERT INTO snapshots VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,object=excluded.object,sha256=excluded.sha256,size=excluded.size').run(id, revision, object, sha256, size);
      }).immediate();
      send(200, { revision, sha256, bytes: size });
    } catch (e) {
      if (!e.status) console.error('SYNC_STORAGE_ERROR', JSON.stringify({ stage, code: /^[A-Z0-9_]+$/.test(e.code || '') ? e.code : 'UNKNOWN' }));
      if (!res.headersSent && !res.destroyed) send(e.status || 500, { error: e.status ? e.message : 'Sync storage operation failed; retained data was not deleted' });
    }
    finally {
      if (counted) active--; reserved -= reservation; uploads.delete(uploadName);
      if (tmp) { try { fs.rmSync(tmp, { force: true }); } catch { console.error('Sync temporary ciphertext retained: cleanup failed; manual storage review required'); } }
    }
  });
  server.keepAliveTimeout = 1000;
  server.on('close', () => db.close());
  return server;
}
