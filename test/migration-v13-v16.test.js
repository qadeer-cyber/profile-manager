import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

const { migrate, migrations, currentVersion } = await import('../server/migrations.js');

function openDb(dir) {
  const file = path.join(dir, 'profiles.db');
  return Database(file);
}

test('migrations v13–v16 add engine, trash, templates, workspaces, cookie robot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-mig-v16-'));
  const db = openDb(dir);
  migrate(db, migrations.filter(m => m.version <= 12));
  assert.ok(currentVersion(db) >= 12);
  db.prepare(`INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES ('p1','Legacy','[]','','',datetime('now'),datetime('now'))`).run();
  migrate(db, migrations.filter(m => m.version > 12));
  assert.equal(currentVersion(db), migrations.at(-1).version);
  const cols = db.prepare('PRAGMA table_info(profiles)').all().map(c => c.name);
  assert.ok(cols.includes('browser_engine'));
  assert.ok(cols.includes('is_quick'));
  assert.ok(cols.includes('deleted_at'));
  assert.ok(cols.includes('workspace_id'));
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='profile_templates'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cookie_robot_jobs'").get());
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
