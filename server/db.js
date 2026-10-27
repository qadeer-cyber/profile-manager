import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { migrate } from './migrations.js';

export const DATA_DIR = path.resolve(process.env.PM_DATA_DIR || 'data');
fs.mkdirSync(path.join(DATA_DIR, 'profiles'), { recursive: true });
export const db = new Database(path.join(DATA_DIR, 'profiles.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');
db.pragma('secure_delete = ON'); // overwrite deleted content with zeros so old secrets don't linger in free pages
export const migration = migrate(db);
export const userDataDir = id => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('invalid profile id');
  return path.join(DATA_DIR, 'profiles', id);
};

export const getSetting = (k, def) => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? JSON.parse(r.value) : def; };
export const setSetting = (k, v) => db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, JSON.stringify(v));

// One-time scrub after secrets were rewritten (re-encryption, inline->library move): rebuild the file so no
// stale page (free list, WAL frames) still holds an old plaintext/ciphertext value.
export function scrubDatabaseFile() {
  const wal = String(db.pragma('journal_mode', { simple: true })).toLowerCase() === 'wal';
  if (wal) db.pragma('wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');
  if (wal) db.pragma('wal_checkpoint(TRUNCATE)');
}
