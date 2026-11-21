// Downgrade safety: a database migrated by a newer AZWAH must not be opened by an older build that
// does not know its schema. The older build must refuse before changing anything, with a clear
// message, so the user can reinstall the newer version (or restore the pre-migration backup).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate, migrations, currentVersion } from '../server/migrations.js';

const latest = Math.max(...migrations.map(m => m.version));

test('a database from a newer AZWAH is refused without being modified', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-newer-schema-'));
  const file = path.join(dir, 'profiles.db');
  const db = new Database(file);
  try {
    migrate(db);
    db.prepare("INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES ('keep','Keep','[]','','','t','t')").run();
    // A future release adds migration latest+1.
    db.prepare('INSERT INTO schema_version VALUES (?,?,?)').run(latest + 1, 'future_feature', new Date().toISOString());
    db.close();
    const before = fs.readFileSync(file);
    const backups = () => fs.readdirSync(dir).filter(f => f.endsWith('.bak')).sort();
    const backupsBefore = backups();

    const reopened = new Database(file);
    try {
      assert.throws(() => migrate(reopened), err => err.code === 'SCHEMA_TOO_NEW'
        && err.message.includes(`version ${latest + 1}`) && err.message.includes(`version ${latest}`)
        && /newer version of AZWAH/i.test(err.message));
      assert.equal(currentVersion(reopened), latest + 1, 'schema version left as written');
      assert.equal(reopened.prepare("SELECT name FROM profiles WHERE id='keep'").get().name, 'Keep');
    } finally { reopened.close(); }
    assert.deepEqual(fs.readFileSync(file), before, 'the database file is unchanged');
    assert.deepEqual(backups(), backupsBefore, 'no new backup or migration was attempted');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the current and older schemas still migrate normally', () => {
  const db = new Database(':memory:');
  try {
    migrate(db, migrations.filter(m => m.version <= 7));
    const r = migrate(db);
    assert.equal(r.to, latest);
    assert.deepEqual(migrate(db).applied, [], 'idempotent at the latest version');
  } finally { db.close(); }
});
