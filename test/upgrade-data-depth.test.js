import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

const { migrate, migrations, currentVersion } = await import('../server/migrations.js');

function openAtVersion(dir, maxVersion) {
  const file = path.join(dir, 'profiles.db');
  const db = new Database(file);
  migrate(db, migrations.filter(m => m.version <= maxVersion));
  return db;
}

test('schema v12→v17 migration preserves profile on-disk markers and row identity', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-up-depth-'));
  const id = randomUUID();
  const profileRoot = path.join(dir, 'profiles', id);
  const defaultDir = path.join(profileRoot, 'Default');
  fs.mkdirSync(defaultDir, { recursive: true });
  fs.writeFileSync(path.join(defaultDir, 'Bookmarks'), '{"roots":{}}');
  fs.writeFileSync(path.join(defaultDir, 'Cookies'), 'sqlite-cookie-placeholder');
  fs.mkdirSync(path.join(defaultDir, 'Local Storage', 'leveldb'), { recursive: true });
  fs.writeFileSync(path.join(defaultDir, 'Local Storage', 'leveldb', 'CURRENT'), 'MANIFEST');

  const db = openAtVersion(dir, 12);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, 'PersistDepth', '["work"]', 'Team', 'notes', now, now);
  db.close();

  const db2 = openAtVersion(dir, migrations.at(-1).version);
  assert.equal(currentVersion(db2), migrations.at(-1).version);
  const row = db2.prepare('SELECT name, folder, tags FROM profiles WHERE id=?').get(id);
  assert.equal(row.name, 'PersistDepth');
  assert.equal(row.folder, 'Team');
  assert.deepEqual(JSON.parse(row.tags), ['work']);
  const cols = db2.prepare('PRAGMA table_info(profiles)').all().map(c => c.name);
  assert.ok(cols.includes('purge_error'));
  db2.close();

  assert.ok(fs.existsSync(path.join(defaultDir, 'Bookmarks')));
  assert.ok(fs.existsSync(path.join(defaultDir, 'Cookies')));
  assert.ok(fs.existsSync(path.join(defaultDir, 'Local Storage', 'leveldb', 'CURRENT')));

  fs.rmSync(dir, { recursive: true, force: true });
});
