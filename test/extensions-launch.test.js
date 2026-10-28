// Launch-boundary tests use a stub browser. They check which extension paths Chromium would receive.
import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-m5-launch-'));
process.env.PM_DATA_DIR = dir;
const calls = [];
mock.module(new URL('../node_modules/playwright/index.mjs', import.meta.url).href, { namedExports: { chromium: {
  launchPersistentContext: async (userDir, opts) => { calls.push({ userDir, opts }); throw new Error('intentional launch boundary'); },
} } });
const { db, setSetting, DATA_DIR } = await import('../server/db.js');
const { importUnpackedExtension, assignExtension, extensionLaunchPlan } = await import('../server/extensions.js');
const { launch } = await import('../server/browsers.js');
setSetting('executablePath', process.execPath);
after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function unpacked(name, permissions) {
  const root = fs.mkdtempSync(path.join(dir, 'src-'));
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ manifest_version: 3, name, version: '1.0.0', permissions }));
  return importUnpackedExtension(root);
}
function profile(id = randomUUID()) {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, id.slice(0, 8), '[]', '', '', now, now);
  return id;
}
const loadArg = opts => opts.args.find(flag => flag.startsWith('--load-extension='));

test('enabled extensions are loaded together and disabled or foreign ones are not', async () => {
  const notes = unpacked('Notes', ['storage']);
  const ads = unpacked('Ads', ['tabs']);
  const alpha = profile();
  const bravo = profile();
  const clean = profile();
  assignExtension(alpha, notes.id, true);
  assignExtension(alpha, ads.id, true);
  assignExtension(bravo, notes.id, false);
  assignExtension(bravo, ads.id, true);
  const start = calls.length;
  await assert.rejects(launch({ id: alpha }, { automation: false }), /intentional launch boundary/);
  await assert.rejects(launch({ id: bravo }, { automation: false }), /intentional launch boundary/);
  await assert.rejects(launch({ id: clean }, { automation: false }), /intentional launch boundary/);
  const alphaOpts = calls[start].opts;
  const bravoOpts = calls[start + 1].opts;
  const cleanOpts = calls[start + 2].opts;
  const notesDir = path.join(DATA_DIR, 'extensions', notes.id);
  const adsDir = path.join(DATA_DIR, 'extensions', ads.id);
  assert.deepEqual(alphaOpts.ignoreDefaultArgs, ['--disable-extensions']);
  assert.ok(loadArg(alphaOpts).includes(notesDir) && loadArg(alphaOpts).includes(adsDir));
  assert.equal(alphaOpts.args.some(flag => flag === '--disable-extensions'), false);
  assert.ok(loadArg(bravoOpts).includes(adsDir));
  assert.equal(loadArg(bravoOpts).includes(notesDir), false);
  assert.equal(loadArg(cleanOpts), undefined);
  assert.equal(cleanOpts.ignoreDefaultArgs, undefined);
  assert.deepEqual(cleanOpts.args, []);
});

test('a missing extension directory blocks launch', async () => {
  const row = unpacked('Gone', ['storage']);
  const id = profile();
  assignExtension(id, row.id, true);
  fs.rmSync(path.join(DATA_DIR, 'extensions', row.id), { recursive: true, force: true });
  const n = calls.length;
  await assert.rejects(launch({ id }, { automation: false }), e => e.status === 500 && e.code === 'EXTENSION_MISSING');
  assert.equal(calls.length, n);
  assert.deepEqual(extensionLaunchPlan(randomUUID()).args, []);
});
