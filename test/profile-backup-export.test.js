import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-pmp-export-'));
process.env.PM_DATA_DIR = dataDir;
const { db, userDataDir } = await import('../server/db.js');
const { createLegacyProfileBackup } = await import('../server/backup.js');
const { unpackArchive } = await import('../server/archive.js');

after(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.PM_DATA_DIR;
});

test('createLegacyProfileBackup packs profile tree with manifest checksums', () => {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, 'Portable', '[]', '', '', now, now);
  const profDir = path.join(userDataDir(id), 'Default');
  fs.mkdirSync(profDir, { recursive: true });
  fs.writeFileSync(path.join(profDir, 'marker.txt'), 'keep');
  const archive = createLegacyProfileBackup(id);
  const files = unpackArchive(archive);
  const meta = JSON.parse(files.find(f => f.path === 'meta.json').data.toString());
  assert.equal(meta.format, 'profile-manager-profile-backup');
  assert.equal(meta.profiles[0].id, id);
  assert.ok(meta.fileChecksums[`profiles/${id}/Default/marker.txt`]);
});
