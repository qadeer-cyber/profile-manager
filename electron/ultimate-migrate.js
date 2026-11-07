// Copy prior Owner profile data and the License Admin vault into the Ultimate
// directory. Sources stay in place. Differing destinations are left untouched.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const OWNER_DIRECTORY = 'azwah-multi-browser-owner';
export const ADMIN_DIRECTORY = 'Azwah License Admin';

function hashFile(file) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Refusing unsafe migration source ${file}`);
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  const temporary = destination + '.' + crypto.randomUUID() + '.tmp';
  fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
  try { fs.renameSync(temporary, destination); }
  finally { fs.rmSync(temporary, {force: true}); }
}
function copyTree(source, destination) {
  if (fs.existsSync(destination)) throw new Error(`Destination already exists: ${destination}`);
  fs.cpSync(source, destination, {recursive: true, dereference: false, errorOnExist: true});
  if (fs.readdirSync(destination, {withFileTypes: true}).some(entry => entry.isSymbolicLink())) throw new Error('Migration copy contains a symlink');
}

export function migrateUltimateData({ appData, ultimateDir }) {
  if (!appData || !ultimateDir) throw new Error('Migration requires the application data root and the Ultimate directory');
  const receiptPath = path.join(ultimateDir, 'azwah-ultimate-migration.json');
  if (fs.existsSync(receiptPath)) {
    const stat = fs.lstatSync(receiptPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw new Error('Unsafe Ultimate migration receipt');
    return JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  }
  fs.mkdirSync(ultimateDir, {recursive: true});
  const ownerData = path.join(appData, OWNER_DIRECTORY, 'data');
  const ownerDb = path.join(ownerData, 'profiles.db');
  const adminVault = path.join(appData, ADMIN_DIRECTORY, 'organization.vault');
  const ultimateData = path.join(ultimateDir, 'data');
  const ultimateDb = path.join(ultimateData, 'profiles.db');
  const ultimateVault = path.join(ultimateDir, 'organization.vault');
  const conflicts = [];
  const copied = [];
  const ownerHash = fs.existsSync(ownerDb) ? hashFile(ownerDb) : null;
  const vaultHash = fs.existsSync(adminVault) ? hashFile(adminVault) : null;
  if (ownerHash && fs.existsSync(ultimateDb)) {
    if (hashFile(ultimateDb) !== ownerHash) conflicts.push({kind: 'owner-data', source: ownerData, destination: ultimateData});
  } else if (ownerHash) {
    copyTree(ownerData, ultimateData);
    if (hashFile(ultimateDb) !== ownerHash) throw new Error('Owner profile database changed while it was copied');
    copied.push({kind: 'owner-data', source: ownerData, sha256: ownerHash});
  }
  if (vaultHash && fs.existsSync(ultimateVault)) {
    if (hashFile(ultimateVault) !== vaultHash) conflicts.push({kind: 'admin-vault', source: adminVault, destination: ultimateVault});
  } else if (vaultHash) {
    copyFile(adminVault, ultimateVault);
    if (hashFile(ultimateVault) !== vaultHash) throw new Error('Administrator vault changed while it was copied');
    copied.push({kind: 'admin-vault', source: adminVault, sha256: vaultHash});
  }
  const receipt = {
    version: 1,
    at: new Date().toISOString(),
    copied,
    conflicts,
    sourcesPreserved: true,
    regeneratedIdentity: false,
  };
  const temporary = receiptPath + '.' + crypto.randomUUID() + '.tmp';
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(receipt, null, 2)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, receiptPath);
  return receipt;
}
