// Copy prior Owner profile data and the License Admin vault into the Ultimate
// directory. Sources stay in place. Differing destinations are left untouched.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const OWNER_DIRECTORY = 'azwah-multi-browser-owner';
export const ADMIN_DIRECTORY = 'azwah-license-admin';
const LEGACY_ADMIN_DIRECTORY = 'Azwah License Admin';

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
function verifyExistingOwnerTree(source, destination) {
  for (const name of fs.readdirSync(source)) {
    const from = path.join(source, name);
    const to = path.join(destination, name);
    const original = fs.lstatSync(from);
    const copied = fs.lstatSync(to, {throwIfNoEntry: false});
    if (original.isDirectory() && copied?.isDirectory()) {
      verifyExistingOwnerTree(from, to);
    } else if (!original.isFile() || !copied?.isFile() || hashFile(from) !== hashFile(to)) {
      throw new Error('Incomplete Owner migration detected. Source and destination were preserved.');
    }
  }
}

function requireClosedOwnerDatabase(db) {
  if (['-wal', '-shm', '-journal'].some(suffix => fs.existsSync(db + suffix))) {
    throw new Error('Close legacy Owner cleanly before migrating. SQLite journal files are still present.');
  }
}

const stagedOwnerMarker = '.azwah-owner-migration.json';

function copyTree(source, destination, expectedDbHash, prepareOwnerData) {
  const staging = fs.mkdtempSync(path.join(path.dirname(destination), '.owner-migration-'));
  const candidate = path.join(staging, 'data');
  try {
    fs.cpSync(source, candidate, {
      recursive: true,
      dereference: false,
      filter(file) {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() && !stat.isDirectory()) throw new Error('Migration source contains an unsupported entry');
        return true;
      },
    });
    const sourceDb = path.join(source, 'profiles.db');
    requireClosedOwnerDatabase(sourceDb);
    if (hashFile(path.join(candidate, 'profiles.db')) !== expectedDbHash || hashFile(sourceDb) !== expectedDbHash) {
      throw new Error('Owner profile database changed while it was copied');
    }
    const marker = path.join(candidate, stagedOwnerMarker);
    if (fs.existsSync(marker)) throw new Error('Unexpected migration marker in Owner source');
    if (prepareOwnerData) {
      prepareOwnerData({source, candidate});
      requireClosedOwnerDatabase(path.join(candidate, 'profiles.db'));
      fs.writeFileSync(marker, JSON.stringify({sourceHash:expectedDbHash, destinationHash:hashFile(path.join(candidate, 'profiles.db'))}), {flag:'wx'});
    }
    requireClosedOwnerDatabase(sourceDb);
    if (hashFile(sourceDb) !== expectedDbHash) throw new Error('Owner database changed during migration');
    if (fs.existsSync(destination)) throw new Error(`Destination already exists: ${destination}`);
    fs.renameSync(candidate, destination);
  } finally {
    fs.rmSync(staging, {recursive: true, force: true});
  }
}

export function migrateUltimateData({ appData, ultimateDir, prepareOwnerData }) {
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
  const packagedVault = path.join(appData, ADMIN_DIRECTORY, 'organization.vault');
  const legacyVault = path.join(appData, LEGACY_ADMIN_DIRECTORY, 'organization.vault');
  const packagedHash = hashFile(packagedVault);
  const legacyHash = hashFile(legacyVault);
  if (packagedHash && legacyHash && packagedHash !== legacyHash) {
    throw new Error('Two different standalone Admin vaults were found. Both sources were preserved.');
  }
  const adminVault = packagedHash ? packagedVault : legacyVault;
  const ultimateData = path.join(ultimateDir, 'data');
  const ultimateDb = path.join(ultimateData, 'profiles.db');
  const ultimateVault = path.join(ultimateDir, 'organization.vault');
  const conflicts = [];
  const copied = [];
  const ownerHash = fs.existsSync(ownerDb) ? hashFile(ownerDb) : null;
  const vaultHash = packagedHash || legacyHash;
  if (ownerHash) requireClosedOwnerDatabase(ownerDb);
  if (ownerHash && fs.existsSync(ultimateDb)) {
    const marker = path.join(ultimateData, stagedOwnerMarker);
    if (fs.existsSync(marker)) {
      const stat = fs.lstatSync(marker);
      if (!stat.isFile() || stat.size > 1024) throw new Error('Unsafe Owner migration marker');
      const recovered = JSON.parse(fs.readFileSync(marker, 'utf8'));
      if (recovered.sourceHash !== ownerHash || recovered.destinationHash !== hashFile(ultimateDb)) {
        throw new Error('Interrupted Owner migration no longer matches the databases. Both were preserved.');
      }
      copied.push({kind:'owner-data',source:ownerData,sha256:ownerHash});
    } else if (hashFile(ultimateDb) !== ownerHash) conflicts.push({kind: 'owner-data', source: ownerData, destination: ultimateData});
    else if (prepareOwnerData) throw new Error('Existing Ultimate database has no credential conversion marker. Both sources were preserved.');
    else verifyExistingOwnerTree(ownerData, ultimateData);
  } else if (ownerHash) {
    copyTree(ownerData, ultimateData, ownerHash, prepareOwnerData);
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
