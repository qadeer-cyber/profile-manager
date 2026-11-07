import './_isolated-data.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {adminInit, adminIssue, adminList, adminLock, adminSaveEmployee, adminStatus, adminUnlock} from '../server/ultimate-admin.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-admin-'));
process.env.AZWAH_ADMIN_VAULT = path.join(dir, 'organization.vault');
process.env.PM_DATA_DIR = path.join(dir, 'data');

test('unlocked administration never returns the signing private key', () => {
  const created = adminInit({organization: 'Synthetic Org', password: 'correct horse battery', confirm: 'correct horse battery'});
  assert.match(created.publicKey, /BEGIN PUBLIC KEY/);
  assert.equal(JSON.stringify(created).includes('PRIVATE KEY'), false);
});

test('wrong password is rejected and a license token is not a private key', () => {
  assert.throws(() => adminUnlock('not-the-vault-password'), /Incorrect password/);
  assert.equal(adminStatus().unlocked, true);
  const device = 'AZD1-' + 'ab'.repeat(32);
  adminSaveEmployee({reference: 'desk', name: 'Desk', device});
  const issued = adminIssue({reference: 'desk', days: 30});
  assert.match(issued.token, /^AZW1\./);
  assert.equal(issued.token.includes('PRIVATE'), false);
  const listed = JSON.stringify(adminList());
  assert.equal(listed.includes('PRIVATE KEY'), false);
  assert.equal(listed.includes(issued.token), false);
  adminLock();
  assert.equal(adminStatus().unlocked, false);
  assert.throws(() => adminList(), /Unlock/);
});
