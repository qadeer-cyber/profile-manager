// License administration for the Ultimate app. The signing key stays in the
// encrypted vault in this process. Responses never include it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {open, save, adminAction} from '../scripts/license-admin/admin.mjs';

let password;
let bridge = {
  async chooseDirectory() { throw Object.assign(new Error('Choose a folder from the desktop app'), {status: 400}); },
  async chooseSaveFile() { throw Object.assign(new Error('Choose a file from the desktop app'), {status: 400}); },
  async chooseRestoreFile() { throw Object.assign(new Error('Choose a backup from the desktop app'), {status: 400}); },
  resourcesPath: process.resourcesPath,
};
export function setDesktopBridge(next) { bridge = {...bridge, ...next}; }
export function chooseRestoreFile() { return bridge.chooseRestoreFile(); }
const vaultFile = () => process.env.AZWAH_ADMIN_VAULT || path.join(path.dirname(process.env.PM_DATA_DIR || '.'), 'organization.vault');
const locked = () => { password = undefined; };
function requireUnlock() {
  if (!password) throw Object.assign(new Error('Unlock the administrator vault first'), {status: 401, code: 'ADMIN_LOCKED'});
  return password;
}
function data() { return open(vaultFile(), requireUnlock()); }
function persist(value) { save(vaultFile(), value, requireUnlock()); }
const RECORD_KEYS = ['id', 'device', 'label', 'issuedAt', 'expiresAt', 'status', 'replacedBy', 'product', 'version'];
function publicRecord(row) {
  const out = {};
  for (const key of RECORD_KEYS) if (row && Object.hasOwn(row, key)) out[key] = row[key];
  return out;
}
function publicEmployee(row) {
  return {reference: row.reference, name: row.name, device: row.device, notes: row.notes || ''};
}
export function adminStatus() {
  const file = vaultFile();
  const exists = fs.existsSync(file);
  if (!password || !exists) return {exists, unlocked: false};
  const value = open(file, password);
  return {exists: true, unlocked: true, organization: value.organization || '', publicKey: value.publicKey};
}
export function adminInit({organization, password: passphrase, confirm}) {
  if (fs.existsSync(vaultFile())) throw Object.assign(new Error('An organization vault already exists'), {status: 409});
  if (!organization?.trim() || organization.length > 120 || passphrase !== confirm) throw Object.assign(new Error('Enter an organization and matching passwords'), {status: 400});
  const created = adminAction({command: 'init', vault: vaultFile(), password: passphrase});
  const value = open(vaultFile(), passphrase);
  value.organization = organization.trim();
  save(vaultFile(), value, passphrase);
  password = passphrase;
  return {organization: value.organization, publicKey: created.publicKey};
}
export function adminUnlock(passphrase) {
  try { open(vaultFile(), passphrase); }
  catch { throw Object.assign(new Error('Incorrect password or damaged vault'), {status: 401, code: 'ADMIN_LOCKED'}); }
  password = passphrase;
  return adminStatus();
}
export function adminLock() { locked(); return adminStatus(); }
export function adminList() {
  const value = data();
  return {
    organization: value.organization || '',
    publicKey: value.publicKey,
    employees: (value.employees || []).map(publicEmployee),
    records: (value.records || []).map(publicRecord),
    audit: (value.audit || []).map(item => ({at: item.at, action: item.action, licenseId: item.licenseId || null, replaces: item.replaces || null})),
  };
}
export function adminSaveEmployee({reference, name, device, notes = ''}) {
  if (!reference?.trim() || !name?.trim() || reference.length > 120 || name.length > 120 || notes.length > 2000 || !/^AZD1-[a-f0-9]{64}$/.test(device || '')) {
    throw Object.assign(new Error('Enter a name, reference and valid device code'), {status: 400});
  }
  const value = data();
  value.employees = (value.employees || []).filter(item => item.reference !== reference);
  value.employees.push({reference: reference.trim(), name: name.trim(), device, notes});
  persist(value);
  return adminList();
}
export function adminIssue({reference, days, licenseId}) {
  const value = data();
  const employee = (value.employees || []).find(item => item.reference === reference);
  if (!employee) throw Object.assign(new Error('Save the employee first'), {status: 400});
  const span = Number(days);
  if (!Number.isInteger(span) || span < 1 || span > 3650) throw Object.assign(new Error('Validity must be 1 to 3650 days'), {status: 400});
  const result = adminAction({
    command: licenseId ? 'reissue' : 'issue',
    vault: vaultFile(),
    password: requireUnlock(),
    device: employee.device,
    label: employee.reference,
    expiresAt: Date.now() + span * 86400000,
    licenseId,
  });
  return {license: publicRecord(result.license), token: result.token};
}
export async function adminBackup() {
  requireUnlock();
  const chosen = await bridge.chooseSaveFile('organization.vault');
  if (!chosen) return {canceled: true};
  fs.copyFileSync(vaultFile(), chosen, fs.constants.COPYFILE_EXCL);
  return {exported: true};
}
export function adminRestore(passphrase, file) {
  if (fs.existsSync(vaultFile())) throw Object.assign(new Error('Restore is available only before an organization vault exists'), {status: 409});
  const value = open(file, passphrase);
  if (!value.organization || !value.publicKey || !value.privateKey) throw Object.assign(new Error('This backup does not contain an organization'), {status: 400});
  save(vaultFile(), value, passphrase, true);
  password = passphrase;
  return adminStatus();
}
export async function adminGenerateOffice({version}) {
  requireUnlock();
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw Object.assign(new Error('Enter a version such as 1.0.0'), {status: 400});
  const directory = await bridge.chooseDirectory();
  if (!directory) return {canceled: true};
  const resources = bridge.resourcesPath;
  const trust = path.join(os.tmpdir(), `azwah-office-trust-${crypto.randomUUID()}.json`);
  const value = data();
  fs.writeFileSync(trust, JSON.stringify({organization: value.organization, publicKey: value.publicKey}), {mode: 0o600});
  const output = path.join(directory, 'Azwah-Multi-Browser-Office-Setup-x64.exe');
  const temporary = path.join(os.tmpdir(), `azwah-office-setup-${crypto.randomUUID()}.exe`);
  try {
    await promisify(execFile)(path.join(resources, 'nsis', 'makensis.exe'), [
      '/V2', '/DPAYLOAD=' + path.join(resources, 'office-payload'), '/DTRUST=' + trust,
      '/DOUTPUT=' + temporary, '/DVERSION=' + version, path.join(resources, 'office.nsi'),
    ], {windowsHide: true, timeout: 600000});
    fs.copyFileSync(temporary, output, fs.constants.COPYFILE_EXCL);
  } finally {
    fs.rmSync(temporary, {force: true});
    fs.rmSync(trust, {force: true});
  }
  return {file: output};
}
