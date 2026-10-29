import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-life-'));
process.env.PM_DATA_DIR = dataDir;
const { db } = await import('../server/db.js');
const {
  softDeleteProfile, restoreFromTrash, listTrash, purgeFromTrash, convertQuickToRegular,
  createTemplateFromProfile, applyTemplate, deleteTemplate,
} = await import('../server/profile-lifecycle.js');

after(() => {
  try { db.close(); } catch {}
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.PM_DATA_DIR;
});

test('soft delete and restore profile', async () => {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, 'Trash me', '[]', '', '', now, now);
  await softDeleteProfile(id, { stopFn: async () => {} });
  assert.equal(listTrash(r => r).length, 1);
  restoreFromTrash(id);
  assert.equal(listTrash(r => r).length, 0);
});

test('convertQuickToRegular clears is_quick', () => {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,is_quick,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, 'Quick', '["quick"]', '', '', 1, now, now);
  convertQuickToRegular(id);
  assert.equal(db.prepare('SELECT is_quick FROM profiles WHERE id=?').get(id).is_quick, 0);
});

test('template create apply and delete', () => {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO profiles (id,name,tags,folder,notes,proxy_id,automation_enabled,browser_engine,browser_settings,webrtc_settings,advanced_settings,is_quick,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, 'Preset', '["work"]', 'Team', '', null, 0, 'chromium', '{"locale":"en-US"}', '{"mode":"browser_default"}', '{}', 0, now, now);
  const getProfile = pid => {
    const row = db.prepare('SELECT * FROM profiles WHERE id=?').get(pid);
    if (!row) return null;
    return {
      ...row,
      browserEngine: row.browser_engine,
      browserSettings: JSON.parse(row.browser_settings),
      webrtcSettings: JSON.parse(row.webrtc_settings),
      advancedSettings: row.advanced_settings ? JSON.parse(row.advanced_settings) : undefined,
      tags: JSON.parse(row.tags),
    };
  };
  const { id: templateId } = createTemplateFromProfile(id, { name: 'My preset', getProfile });
  const newId = applyTemplate(templateId, {
    name: 'Spawned',
    insertFn: v => {
      const nid = randomUUID();
      db.prepare(`INSERT INTO profiles (id,name,tags,folder,notes,proxy_id,automation_enabled,browser_engine,browser_settings,webrtc_settings,advanced_settings,is_quick,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(nid, v.name, JSON.stringify(v.tags), v.folder, v.notes, v.proxyId, v.automationEnabled ? 1 : 0, v.browserEngine, JSON.stringify(v.browserSettings), JSON.stringify(v.webrtcSettings), JSON.stringify(v.advancedSettings || {}), 0, now, now);
      return nid;
    },
    getTemplateSnapshot: row => JSON.parse(row.snapshot_json),
  });
  const spawned = db.prepare('SELECT folder, browser_settings FROM profiles WHERE id=?').get(newId);
  assert.equal(spawned.folder, 'Team');
  assert.equal(JSON.parse(spawned.browser_settings).locale, 'en-US');
  deleteTemplate(templateId);
  assert.equal(db.prepare('SELECT id FROM profile_templates WHERE id=?').get(templateId), undefined);
});

test('purge requires confirmName', async () => {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, 'Exact', '[]', '', '', now, now);
  await softDeleteProfile(id, { stopFn: async () => {} });
  await assert.rejects(async () => purgeFromTrash(id, { confirmName: 'wrong' }), /confirmName/);
  await purgeFromTrash(id, { confirmName: 'Exact' });
  assert.equal(db.prepare('SELECT id FROM profiles WHERE id=?').get(id), undefined);
});
