import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const ownerBeforePack = require('../scripts/owner-before-pack.cjs');
const ultimateBeforePack = require('../scripts/ultimate-before-pack.cjs');
const {doMergeConfigs} = require('app-builder-lib/out/util/config/config.js');
const officePayload = fs.readFileSync(new URL('../electron-builder.office-payload.cjs', import.meta.url), 'utf8');
const ultimateConfig = fs.readFileSync(new URL('../electron-builder.ultimate-unified.cjs', import.meta.url), 'utf8');

function context(config) {
  return {packager: {config}};
}

function withoutStagedFirefox(load) {
  const original = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (String(id).includes('firefox-extra-resources.cjs')) return [];
    return original.apply(this, arguments);
  };
  try { return load(); }
  finally { Module.prototype.require = original; }
}

test('the Owner packager still rejects a unified identity', async () => {
  await assert.rejects(() => ownerBeforePack(context({
    appId: 'local.azwahmultibrowser.ultimate',
    extraMetadata: {name: 'azwah-multi-browser-ultimate', azwahEdition: 'ultimate', azwahLicensePolicy: 'browser-without-activation-admin-vault-in-process'},
  })), /Explicit Owner\/Personal distribution policy required/);
});

test('the Ultimate packager accepts only the integrated Ultimate identity', async () => {
  await ultimateBeforePack(context({
    appId: 'local.azwahmultibrowser.ultimate',
    extraMetadata: {name: 'azwah-multi-browser-ultimate', azwahEdition: 'ultimate'},
    files: ['electron/**', 'server/**', 'scripts/license-admin/**'],
  }));
  const normalized = doMergeConfigs([{
    appId: 'local.azwahmultibrowser.ultimate',
    extraMetadata: {name: 'azwah-multi-browser-ultimate', azwahEdition: 'ultimate'},
    files: ['electron/**', 'server/**', 'scripts/license-admin/**'],
  }]);
  assert.equal(normalized.files.some(item => String(item).includes('license-admin')), false);
  await ultimateBeforePack(context(normalized));
  await assert.rejects(() => ultimateBeforePack(context({
    ...normalized,
    files: [{filter: ['electron/**', 'server/**', '!scripts/license-admin/**']}],
  })), /Ultimate package must include the in-process license administration module/);
  await assert.rejects(() => ultimateBeforePack(context({
    appId: 'local.azwahmultibrowser.owner',
    extraMetadata: {name: 'azwah-multi-browser-owner', azwahEdition: 'owner-personal'},
    files: ['scripts/license-admin/**'],
  })), /Explicit Ultimate distribution policy required/);
});

test('the effective Ultimate config keeps administration and the employee payload removes it', async () => {
  const {ultimate, office} = withoutStagedFirefox(() => ({
    ultimate: require('../electron-builder.ultimate-unified.cjs'),
    office: require('../electron-builder.office-payload.cjs'),
  }));
  const effective = doMergeConfigs([structuredClone(ultimate)]);
  await ultimateBeforePack(context(effective));
  const employee = doMergeConfigs([{files: structuredClone(office.files)}]);
  const employeePatterns = employee.files.flatMap(item => item.filter || []);
  assert.equal(employeePatterns.includes('!scripts/license-admin/**'), true);
  assert.equal(employeePatterns.includes('!server/ultimate-admin.js'), true);
  assert.equal(employeePatterns.includes('!admin-desktop/**'), true);
  await assert.rejects(() => ultimateBeforePack(context({
    appId: 'local.azwahmultibrowser.ultimate',
    extraMetadata: {name: 'azwah-multi-browser-ultimate', azwahEdition: 'ultimate'},
    files: employee.files,
  })), /Ultimate package must include the in-process license administration module/);
});

test('the employee Office payload excludes issuance code and signing material', () => {
  assert.match(officePayload, /!server\/ultimate-admin\.js/);
  assert.match(officePayload, /!scripts\/license-admin/);
  assert.match(officePayload, /!admin-desktop/);
  assert.match(officePayload, /issuer-public\.pem/);
  assert.match(ultimateConfig, /azwah-multi-browser-ultimate/);
  assert.match(ultimateConfig, /scripts\/license-admin/);
  assert.equal(officePayload.includes('signDlls'), false);
  assert.equal(path.basename(new URL('../server/office/license.js', import.meta.url).pathname).endsWith('license.js'), true);
  const officeDir = fs.readdirSync(new URL('../server/office/', import.meta.url));
  assert.equal(officeDir.some(name => /vault|private|issuer-public/i.test(name)), false);
});
