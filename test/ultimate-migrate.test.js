import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { migrateUltimateData, seedLegacyWindowsOwnerKey, OWNER_DIRECTORY, ADMIN_DIRECTORY } from '../electron/ultimate-migrate.js';

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

test('migration still accepts a vault in the historical display-name directory', () => {
  const {appData, ultimate, adminDir} = layout();
  const oldAdminDir = path.join(appData, 'Azwah License Admin');
  fs.renameSync(adminDir, oldAdminDir);
  const receipt = migrateUltimateData({appData, ultimateDir: ultimate});
  const original = path.join(oldAdminDir, 'organization.vault');
  assert.equal(receipt.copied.find(item => item.kind === 'admin-vault').source, original);
  assert.equal(sha(path.join(ultimate, 'organization.vault')), sha(original));
});

test('different standalone vaults are preserved and migration stops before copying', () => {
  const {appData, ultimate, ownerData, adminDir} = layout();
  const oldAdminDir = path.join(appData, 'Azwah License Admin');
  fs.mkdirSync(oldAdminDir);
  const oldVault = path.join(oldAdminDir, 'organization.vault');
  fs.writeFileSync(oldVault, 'different sealed vault');
  assert.throws(() => migrateUltimateData({appData, ultimateDir: ultimate}), /Two different standalone Admin vaults/);
  assert.equal(fs.existsSync(path.join(ultimate, 'data')), false);
  assert.equal(fs.existsSync(path.join(ultimate, 'azwah-ultimate-migration.json')), false);
  assert.equal(fs.readFileSync(path.join(ownerData, 'profiles.db'), 'utf8'), 'owner-profiles');
  assert.equal(fs.readFileSync(path.join(adminDir, 'organization.vault'), 'utf8'), 'sealed-vault');
  assert.equal(fs.readFileSync(oldVault, 'utf8'), 'different sealed vault');
});

test('a matching database alone cannot finalize an interrupted Owner copy', t => {
  const {appData, ultimate, ownerData} = layout();
  t.after(() => fs.rmSync(appData, {recursive: true, force: true}));
  const cookie = path.join(ownerData, 'profiles', 'alpha', 'Cookies');
  fs.mkdirSync(path.dirname(cookie), {recursive: true});
  fs.writeFileSync(cookie, 'synthetic browser state');
  const destination = path.join(ultimate, 'data');
  fs.mkdirSync(destination, {recursive: true});
  fs.copyFileSync(path.join(ownerData, 'profiles.db'), path.join(destination, 'profiles.db'));
  assert.throws(() => migrateUltimateData({appData, ultimateDir: ultimate}), /Incomplete Owner migration/);
  assert.equal(fs.existsSync(path.join(ultimate, 'azwah-ultimate-migration.json')), false);
  assert.equal(fs.readFileSync(cookie, 'utf8'), 'synthetic browser state');
  const copiedCookie = path.join(destination, 'profiles', 'alpha', 'Cookies');
  fs.mkdirSync(path.dirname(copiedCookie), {recursive: true});
  fs.copyFileSync(cookie, copiedCookie);
  const retried = migrateUltimateData({appData, ultimateDir: ultimate});
  assert.deepEqual(retried.conflicts, []);
});

test('an unsupported nested entry leaves the active destination untouched', t => {
  const {appData, ultimate, ownerData} = layout();
  t.after(() => fs.rmSync(appData, {recursive: true, force: true}));
  const nested = path.join(ownerData, 'profiles', 'alpha');
  fs.mkdirSync(nested, {recursive: true});
  const target = path.join(appData, 'outside');
  fs.mkdirSync(target);
  fs.symlinkSync(target, path.join(nested, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => migrateUltimateData({appData, ultimateDir: ultimate}), /unsupported entry/);
  assert.equal(fs.existsSync(path.join(ultimate, 'data')), false);
  assert.equal(fs.existsSync(path.join(ultimate, 'azwah-ultimate-migration.json')), false);
  assert.deepEqual(fs.readdirSync(ultimate), []);
  assert.equal(fs.readFileSync(path.join(ownerData, 'profiles.db'), 'utf8'), 'owner-profiles');
});

test('a live SQLite WAL prevents migration even if the main file hash has not changed', async t => {
  const {DatabaseSync} = await import('node:sqlite');
  const {appData, ultimate, ownerData} = layout();
  const file = path.join(ownerData, 'profiles.db');
  fs.rmSync(file);
  const database = new DatabaseSync(file);
  t.after(() => {
    database.close();
    fs.rmSync(appData, {recursive: true, force: true});
  });
  database.exec('PRAGMA journal_mode=WAL; CREATE TABLE profiles(name TEXT); PRAGMA wal_checkpoint(TRUNCATE);');
  const before = sha(file);
  database.exec("INSERT INTO profiles VALUES ('pending checkpoint')");
  assert.equal(sha(file), before);
  assert.ok(fs.statSync(file + '-wal').size > 0);
  assert.throws(() => migrateUltimateData({appData, ultimateDir: ultimate}), /SQLite journal files/);
  assert.equal(fs.existsSync(path.join(ultimate, 'data')), false);
  assert.equal(database.prepare('SELECT name FROM profiles').get().name, 'pending checkpoint');
});

test('Windows migration seeds only the opaque DPAPI key and leaves the Owner state untouched', t => {
  const {appData, ultimate, ownerData} = layout();
  t.after(() => fs.rmSync(appData,{recursive:true,force:true}));
  const source = path.join(path.dirname(ownerData),'Local State');
  const target = path.join(ultimate,'Local State');
  const key = Buffer.from('DPAPIsynthetic test data').toString('base64');
  const raw = JSON.stringify({unrelated:{setting:true},os_crypt:{encrypted_key:key}});
  fs.writeFileSync(source,raw);
  assert.equal(seedLegacyWindowsOwnerKey({appData,ultimateDir:ultimate}),true);
  assert.deepEqual(JSON.parse(fs.readFileSync(target,'utf8')),{os_crypt:{encrypted_key:key}});
  assert.equal(fs.readFileSync(source,'utf8'),raw);
  assert.equal(seedLegacyWindowsOwnerKey({appData,ultimateDir:ultimate}),false);
});

test('Windows migration preserves an existing incompatible Local State', t => {
  const {appData, ultimate, ownerData} = layout();
  t.after(() => fs.rmSync(appData,{recursive:true,force:true}));
  const key = Buffer.from('DPAPIsynthetic test data').toString('base64');
  fs.writeFileSync(path.join(path.dirname(ownerData),'Local State'),JSON.stringify({os_crypt:{encrypted_key:key}}));
  const target = path.join(ultimate,'Local State');
  fs.mkdirSync(ultimate);
  fs.writeFileSync(target,'{"other":true}');
  assert.throws(() => seedLegacyWindowsOwnerKey({appData,ultimateDir:ultimate}),/Conflicting Windows secret storage/);
  assert.equal(fs.readFileSync(target,'utf8'),'{"other":true}');
  assert.equal(fs.existsSync(path.join(ultimate,'data')),false);
});
