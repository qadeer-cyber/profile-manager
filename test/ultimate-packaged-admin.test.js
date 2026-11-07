import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const {doMergeConfigs} = require('app-builder-lib/out/util/config/config.js');
const {getMainFileMatchers} = require('app-builder-lib/out/fileMatcher.js');
const ultimateBeforePack = require('../scripts/ultimate-before-pack.cjs');
const ownerBeforePack = require('../scripts/owner-before-pack.cjs');
const root = path.resolve(new URL('..', import.meta.url).pathname);

function withoutStagedFirefox(load) {
  const original = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (String(id).includes('firefox-extra-resources.cjs')) return [];
    return original.apply(this, arguments);
  };
  try { return load(); }
  finally { Module.prototype.require = original; }
}

function effective(config) {
  const clone = structuredClone({...config, beforePack: typeof config.beforePack === 'function' ? undefined : config.beforePack});
  return doMergeConfigs([clone]);
}

function fileFilter(config) {
  const output = path.join(root, config.directories?.output || 'release-test');
  const info = {
    isPrepackedAppAsar: false,
    projectDir: root,
    buildResourcesDir: path.join(root, 'build'),
    config,
    debugLogger: {isEnabled: false},
  };
  const matchers = getMainFileMatchers(root, path.join(output, 'resources', 'app'), value => value, {}, {info}, output, false);
  return {filter: matchers[0].createFilter(), patterns: matchers[0].patterns};
}

function kept(filter, relativePath) {
  const file = path.join(root, relativePath);
  return filter(file, fs.statSync(file));
}

test('the real beforePack context packs the admin module and Office drops it', async () => {
  const {ultimate, office, owner} = withoutStagedFirefox(() => ({
    ultimate: require('../electron-builder.ultimate-unified.cjs'),
    office: require('../electron-builder.office-payload.cjs'),
    owner: require('../electron-builder.owner.cjs'),
  }));
  const ultimateConfig = effective(ultimate);
  const officeConfig = effective(office);
  const ownerConfig = effective(owner);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-pack-'));
  await ultimateBeforePack({
    outDir,
    appOutDir: path.join(outDir, 'win-unpacked'),
    electronPlatformName: 'win32',
    arch: 1,
    targets: [],
    packager: {config: ultimateConfig, projectDir: root},
  });
  await assert.rejects(() => ultimateBeforePack({
    outDir,
    appOutDir: path.join(outDir, 'win-unpacked'),
    electronPlatformName: 'win32',
    arch: 1,
    targets: [],
    packager: {config: officeConfig, projectDir: root},
  }), /Explicit Ultimate distribution policy required/);
  await ownerBeforePack({packager: {config: ownerConfig, projectDir: root}});
  await assert.rejects(() => ownerBeforePack({packager: {config: ultimateConfig}}), /Explicit Owner\/Personal distribution policy required/);

  const ultimateFiles = fileFilter(ultimateConfig);
  const officeFiles = fileFilter(officeConfig);
  const ownerFiles = fileFilter(ownerConfig);
  for (const relativePath of ['server/ultimate-admin.js', 'scripts/license-admin/admin.mjs', 'scripts/license-admin/issuer.mjs']) {
    assert.equal(kept(ultimateFiles.filter, relativePath), true, `Ultimate pack includes ${relativePath}`);
    assert.equal(kept(officeFiles.filter, relativePath), false, `Office pack excludes ${relativePath}`);
  }
  assert.equal(kept(ownerFiles.filter, 'scripts/license-admin/admin.mjs'), false);
  assert.equal(kept(ownerFiles.filter, 'scripts/license-admin/issuer.mjs'), false);
  assert.equal(ultimateFiles.patterns.includes('scripts/license-admin/**'), true);
  assert.equal(officeFiles.patterns.includes('!scripts/license-admin/**'), true);
  assert.equal(officeFiles.patterns.includes('!server/ultimate-admin.js'), true);

  const stage = path.join(outDir, 'stage');
  const packaged = ['package.json', 'server/ultimate-admin.js', 'server/office/license.js', 'scripts/license-admin/admin.mjs', 'scripts/license-admin/issuer.mjs'];
  assert.equal(kept(ultimateFiles.filter, 'server/office/license.js'), true);
  for (const relativePath of packaged) {
    const destination = path.join(stage, relativePath);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.copyFileSync(path.join(root, relativePath), destination);
  }
  const metadata = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
  Object.assign(metadata, ultimateConfig.extraMetadata);
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(metadata));
  const archive = path.join(outDir, 'app.asar');
  await asar.createPackage(stage, archive);
  const names = asar.listPackage(archive).map(name => name.replaceAll('\\', '/'));
  assert.ok(names.includes('/server/ultimate-admin.js') || names.includes('server/ultimate-admin.js'));
  assert.equal(names.some(name => name.includes('license-admin/admin.mjs')), true);
  const unpacked = path.join(outDir, 'unpacked');
  asar.extractAll(archive, unpacked);
  const result = JSON.parse(execFileSync(process.execPath, [path.join(root, 'test/fixtures/load-packaged-admin.mjs'), unpacked], {
    encoding: 'utf8',
    timeout: 30000,
  }));
  assert.equal(result.locked.exists, false);
  assert.equal(result.locked.unlocked, false);
  assert.equal(result.lockedList, 'ADMIN_LOCKED');
  assert.equal(result.opened.unlocked, true);
  assert.match(result.opened.publicKey, /BEGIN PUBLIC KEY/);
  assert.equal(result.opened.publicKey.includes('PRIVATE'), false);
  assert.equal(result.serialized.includes('PRIVATE KEY'), false);
  assert.equal(result.vault.includes('PRIVATE KEY'), false);
  assert.equal(result.afterLock.unlocked, false);
  assert.equal(result.issuanceWhileLocked, 'ADMIN_LOCKED');
});

test('packaged Owner metadata stays unlocked and Office metadata does not', () => {
  const owner = effective(require('../electron-builder.owner.cjs'));
  const office = withoutStagedFirefox(() => effective(require('../electron-builder.office-payload.cjs')));
  const ultimate = withoutStagedFirefox(() => effective(require('../electron-builder.ultimate-unified.cjs')));
  const ownerState = packagedActivation(owner.extraMetadata);
  const ultimateState = packagedActivation(ultimate.extraMetadata);
  const officeState = packagedActivation(office.extraMetadata);
  assert.equal(ownerState.status.enforced, false);
  assert.equal(ownerState.status.active, true);
  assert.equal(ownerState.status.edition, 'owner-personal');
  assert.equal(ownerState.activationCode, 'OWNER_NO_ACTIVATION');
  assert.equal(ultimateState.status.enforced, false);
  assert.equal(ultimateState.status.active, true);
  assert.equal(ultimateState.status.edition, 'ultimate');
  assert.match(ultimateState.status.licensePolicy, /locked administrator vault/);
  assert.equal(ultimateState.activationCode, 'OWNER_NO_ACTIVATION');
  assert.equal(officeState.status.active, false);
  assert.equal(officeState.status.edition, undefined);
  assert.notEqual(officeState.activationCode, 'OWNER_NO_ACTIVATION');
});

function packagedActivation(extraMetadata) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-edition-'));
  const source = path.join(root, 'server/office');
  fs.mkdirSync(path.join(directory, 'server/office'), {recursive: true});
  for (const name of ['edition.js', 'activation.js', 'license.js', 'device.js']) {
    fs.copyFileSync(path.join(source, name), path.join(directory, 'server/office', name));
  }
  fs.writeFileSync(path.join(directory, 'server/db.js'), 'export const DATA_DIR = process.env.PM_DATA_DIR;\n');
  fs.writeFileSync(path.join(directory, 'server/secrets.js'), 'export const encrypt = () => { throw new Error("unused"); };\nexport const decrypt = () => { throw new Error("unused"); };\nexport const encryptionStatus = () => ({backend: "test"});\n');
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  Object.assign(metadata, extraMetadata);
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(metadata));
  fs.writeFileSync(path.join(directory, 'run.mjs'), `import {activationStatus, activateOffice} from './server/office/activation.js';
const status = activationStatus();
let activationCode = null;
try { activateOffice('AZW1.not-a-license.signature'); }
catch (error) { activationCode = error.code; }
process.stdout.write(JSON.stringify({status, activationCode}));
`);
  return JSON.parse(execFileSync(process.execPath, [path.join(directory, 'run.mjs')], {
    encoding: 'utf8',
    cwd: directory,
    env: {...process.env, PM_DATA_DIR: path.join(directory, 'data'), AZWAH_OFFICE_ENFORCE: '1'},
    timeout: 20000,
  }));
}
