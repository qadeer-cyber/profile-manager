import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { migrateUltimateData, OWNER_DIRECTORY, ADMIN_DIRECTORY } from '../electron/ultimate-migrate.js';

function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function layout() {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-app-'));
  const ultimate = path.join(appData, 'azwah-multi-browser-ultimate');
  const ownerData = path.join(appData, OWNER_DIRECTORY, 'data');
  const adminDir = path.join(appData, ADMIN_DIRECTORY);
  fs.mkdirSync(ownerData, {recursive: true});
  fs.mkdirSync(adminDir, {recursive: true});
  fs.writeFileSync(path.join(ownerData, 'profiles.db'), 'owner-profiles');
  fs.writeFileSync(path.join(adminDir, 'organization.vault'), 'sealed-vault');
  return {appData, ultimate, ownerData, adminDir};
}

test('migration copies owner data and the admin vault without removing the sources', () => {
  const {appData, ultimate, ownerData, adminDir} = layout();
  const receipt = migrateUltimateData({appData, ultimateDir: ultimate});
  assert.equal(receipt.conflicts.length, 0);
  assert.equal(fs.readFileSync(path.join(ultimate, 'data', 'profiles.db'), 'utf8'), 'owner-profiles');
  assert.equal(fs.readFileSync(path.join(ultimate, 'organization.vault'), 'utf8'), 'sealed-vault');
  assert.equal(sha(path.join(ownerData, 'profiles.db')), sha(path.join(ultimate, 'data', 'profiles.db')));
  assert.equal(fs.existsSync(path.join(adminDir, 'organization.vault')), true);
  const again = migrateUltimateData({appData, ultimateDir: ultimate});
  assert.equal(again.copied.length, receipt.copied.length);
});

test('migration refuses to overwrite a different existing vault or database', () => {
  const {appData, ultimate} = layout();
  fs.mkdirSync(path.join(ultimate, 'data'), {recursive: true});
  fs.writeFileSync(path.join(ultimate, 'data', 'profiles.db'), 'newer-profiles');
  fs.writeFileSync(path.join(ultimate, 'organization.vault'), 'newer-vault');
  const receipt = migrateUltimateData({appData, ultimateDir: ultimate});
  assert.deepEqual(receipt.copied, []);
  assert.equal(receipt.conflicts.map(item => item.kind).sort().join(), 'admin-vault,owner-data');
  assert.equal(fs.readFileSync(path.join(ultimate, 'data', 'profiles.db'), 'utf8'), 'newer-profiles');
  assert.equal(fs.readFileSync(path.join(appData, OWNER_DIRECTORY, 'data', 'profiles.db'), 'utf8'), 'owner-profiles');
});
