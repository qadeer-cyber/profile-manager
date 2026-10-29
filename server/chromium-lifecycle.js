// Local Chromium install backup and rollback. No cloud update service.
import fs from 'fs';
import path from 'path';
import { installDir, browsersRoot, installOne, MANIFEST } from './chromium.js';
import { chromiumIdentity } from './chromium-identity.js';

const BACKUP_SUFFIX = '.pm-backup-';

export function listInstallBackups(name, { root = browsersRoot(), manifest = MANIFEST } = {}) {
  const dir = installDir(name, { root, manifest });
  const parent = path.dirname(dir);
  const base = path.basename(dir);
  if (!fs.existsSync(parent)) return [];
  return fs.readdirSync(parent)
    .filter(entry => entry.startsWith(base + BACKUP_SUFFIX))
    .map(entry => {
      const full = path.join(parent, entry);
      let verified = null;
      try { verified = JSON.parse(fs.readFileSync(path.join(full, '.pm-verified.json'), 'utf8')); } catch {}
      return { name, path: full, createdAt: entry.slice(base.length + BACKUP_SUFFIX.length), verified: !!verified };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function backupInstallDir(name, { root = browsersRoot(), manifest = MANIFEST } = {}) {
  const dir = installDir(name, { root, manifest });
  if (!fs.existsSync(dir)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = dir + BACKUP_SUFFIX + stamp;
  fs.renameSync(dir, dest);
  return dest;
}

export function restoreInstallBackup(backupPath, name, { root = browsersRoot(), manifest = MANIFEST } = {}) {
  const dir = installDir(name, { root, manifest });
  const resolved = path.resolve(backupPath);
  const parent = path.resolve(path.dirname(dir));
  if (resolved !== parent && !resolved.startsWith(parent + path.sep)) {
    throw Object.assign(new Error('Backup path is outside the browsers root'), { status: 400, code: 'BAD_BACKUP_PATH' });
  }
  if (!fs.existsSync(resolved)) throw Object.assign(new Error('Backup directory not found'), { status: 404, code: 'BACKUP_NOT_FOUND' });
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(resolved, dir);
  return dir;
}

export function rollbackLatest(name, { root = browsersRoot(), manifest = MANIFEST } = {}) {
  const backups = listInstallBackups(name, { root, manifest });
  if (!backups.length) throw Object.assign(new Error('No local Chromium backup to roll back to'), { status: 404, code: 'NO_BACKUP' });
  return restoreInstallBackup(backups[0].path, name, { root, manifest });
}

export async function installWithBackup(name, opts = {}) {
  const backup = backupInstallDir(name, opts);
  try {
    return { backup, result: await installOne(name, opts) };
  } catch (error) {
    if (backup && fs.existsSync(backup)) {
      try { restoreInstallBackup(backup, name, opts); } catch {}
    }
    throw error;
  }
}

export async function installVerifiedChromiumWithBackup(opts = {}) {
  const names = opts.names || ['chromium', 'chromium-headless-shell'];
  const out = [];
  for (const name of names) {
    const dir = installDir(name, opts);
    if (fs.existsSync(dir)) out.push((await installWithBackup(name, opts)).result);
    else out.push(await installOne(name, opts));
  }
  return out;
}

export function executableCompatibility(executablePath) {
  const identity = chromiumIdentity(executablePath || '');
  return {
    ...identity,
    launchAllowed: !identity.versionMismatch,
    warning: identity.versionMismatch
      ? `The executable reports ${identity.executableVersion}, but this app pins ${identity.pinnedVersion}. Launch is blocked until the path is cleared or Chromium is reinstalled to the pinned build.`
      : null,
  };
}
