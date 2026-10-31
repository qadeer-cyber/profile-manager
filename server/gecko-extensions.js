// Firefox extension library. Import validation is not signature verification or installation.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db, DATA_DIR } from './db.js';
import { validateXpiArchive, XPI_LIMITS } from './gecko-xpi.js';

const invalid = (message, status = 400, code = 'INVALID_GECKO_EXTENSION') => {
  throw Object.assign(new Error(message), { status, code });
};

function geckoStoragePath(rel) {
  if (typeof rel !== 'string' || !/^gecko-extensions\/[0-9a-f-]{36}$/i.test(rel)) invalid('gecko extension storage path is invalid', 500, 'GECKO_EXTENSION_PATH');
  const root = path.resolve(DATA_DIR, 'gecko-extensions');
  const abs = path.resolve(DATA_DIR, rel);
  if (path.dirname(abs) !== root) invalid('gecko extension storage path is invalid', 500, 'GECKO_EXTENSION_PATH');
  return abs;
}

function manifestMetadata(bytes) {
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); } catch { invalid('manifest.json is not valid JSON'); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) invalid('manifest.json must be an object');
  if (![2, 3].includes(manifest.manifest_version)) invalid('manifest_version must be 2 or 3');
  const gecko = manifest.browser_specific_settings?.gecko || manifest.applications?.gecko;
  if (typeof gecko?.id !== 'string' || gecko.id.length > 128 ||
      !/^(?:[a-z0-9._+-]+@[a-z0-9._-]+|\{[0-9a-f-]{36}\})$/i.test(gecko.id)) invalid('manifest must include a safe gecko.id');
  if (typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 128 || /[\u0000-\u001f]/.test(manifest.name)) invalid('manifest name is invalid');
  if (typeof manifest.version !== 'string' || !manifest.version || manifest.version.length > 32 || /[\u0000-\u001f]/.test(manifest.version)) invalid('manifest version is invalid');
  return { geckoId: gecko.id, name: manifest.name.trim(), version: manifest.version, manifestVersion: manifest.manifest_version };
}

export function readGeckoManifestFromDir(dir) {
  const file = path.join(dir, 'manifest.json');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > XPI_LIMITS.manifest) invalid('manifest.json must be a bounded regular file');
  return manifestMetadata(fs.readFileSync(file));
}

function insertGeckoExtensionRow(meta, rel) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO extensions (id,name,version,description,manifest_version,permissions,host_permissions,optional_permissions,optional_host_permissions,storage_dir,created_at,updated_at,browser_engine,gecko_extension_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, meta.name, meta.version, '', meta.manifestVersion, '[]', '[]', '[]', '[]', rel, now, now, 'firefox', meta.geckoId);
  return extensionRow(id);
}

export function importXpiGeckoExtension(xpiPath) {
  if (typeof xpiPath !== 'string' || !path.isAbsolute(xpiPath)) invalid('path must be an absolute .xpi file');
  if (!xpiPath.toLowerCase().endsWith('.xpi')) invalid('path must end with .xpi');
  const stat = fs.lstatSync(xpiPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > XPI_LIMITS.archive) invalid('XPI must be a regular file of at most 32 MiB');
  const buf = fs.readFileSync(xpiPath);
  const entries = validateXpiArchive(buf);
  const manifestBuf = entries.get('manifest.json');
  if (!manifestBuf) invalid('manifest.json is required');
  const meta = manifestMetadata(manifestBuf);
  return storeGeckoExtension(meta, dest => {
    fs.writeFileSync(path.join(dest, 'extension.xpi'), buf, { mode: 0o600 });
    fs.writeFileSync(path.join(dest, 'manifest.json'), manifestBuf, { mode: 0o600 });
  });
}

function storeGeckoExtension(meta, copy) {
  const rel = `gecko-extensions/${crypto.randomUUID()}`;
  const dest = geckoStoragePath(rel);
  try {
    fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
    copy(dest);
    return insertGeckoExtensionRow(meta, rel);
  } catch (error) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw error;
  }
}

export function importUnpackedGeckoExtension(sourcePath) {
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) invalid('path must be an absolute directory');
  const stat = fs.lstatSync(sourcePath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) invalid('path must be a regular directory');
  const root = fs.realpathSync(sourcePath);
  const meta = readGeckoManifestFromDir(root);
  const files = [];
  let total = 0, count = 0;
  const visit = (dir, depth = 0) => {
    if (depth > 32) invalid('extension nesting exceeds limits');
    for (const name of fs.readdirSync(dir)) {
      if (++count > XPI_LIMITS.entries || /[\\:\u0000-\u001f]/.test(name)) invalid('extension tree exceeds limits or contains unsafe paths');
      const file = path.join(dir, name), info = fs.lstatSync(file);
      if (info.isSymbolicLink()) invalid('extension symlinks are forbidden');
      if (info.isDirectory()) visit(file, depth + 1);
      else if (info.isFile()) {
        total += info.size;
        if (info.size > XPI_LIMITS.entry || total > XPI_LIMITS.total) invalid('extension size exceeds limits');
        files.push(file);
      } else invalid('extension special files are forbidden');
    }
  };
  visit(root);
  return storeGeckoExtension(meta, dest => {
    for (const file of files) {
      const target = path.join(dest, path.relative(root, file));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
    }
    readGeckoManifestFromDir(dest);
  });
}

export function readGeckoProfileExtensions(profileDir) {
  const file = path.join(profileDir, 'extensions.json');
  if (!fs.existsSync(file)) return { schemaVersion: null, addons: [] };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const addons = Array.isArray(data.addons) ? data.addons : [];
    return {
      schemaVersion: data.schemaVersion ?? null,
      addons: addons.map(a => ({
        id: a.id,
        version: a.version,
        active: a.active !== false,
        userDisabled: !!a.userDisabled,
        appDisabled: !!a.appDisabled,
        type: a.type || 'extension',
      })),
    };
  } catch {
    return { schemaVersion: null, addons: [], corrupt: true };
  }
}

export function setGeckoProfileExtensionEnabled(profileDir, geckoId, enabled) {
  invalid('Enable or disable Firefox add-ons in about:addons. Offline editing of Firefox extensions.json is unsupported.', 501, 'GECKO_EXTENSION_TOGGLE_UNSUPPORTED');
}

export function extensionRow(id) {
  return db.prepare('SELECT * FROM extensions WHERE id=?').get(id);
}

export function listGeckoExtensions() {
  return db.prepare("SELECT * FROM extensions WHERE browser_engine='firefox' ORDER BY created_at DESC").all();
}

export function geckoExtensionReport() {
  return {
    generatedAt: new Date().toISOString(),
    signingPolicy: 'Signature and compatibility verification are performed by Firefox on installation, never by this importer.',
    importFormats: ['unpacked development directory', '.xpi (stored or deflated ZIP)'],
    automaticInstallation: false,
    offlineToggle: false,
    note: 'Library assignments are inventory only. Install signed XPI files using Firefox about:addons > Install Add-on From File. Enable, disable, and remove there. Unpacked development extensions use about:debugging and are temporary.',
  };
}

/** Inventory only: stock Firefox does not support these offline installation/toggle writes. */
export function materializeGeckoExtensions(profileDir, profileId) {
  const rows = db.prepare(`SELECT e.id FROM extensions e
    JOIN profile_extensions pe ON pe.extension_id = e.id
    WHERE pe.profile_id = ? AND e.browser_engine = 'firefox' AND pe.enabled = 1`).all(profileId);
  return { count: 0, pendingManualInstallation: rows.map(row => row.id), capability: 'manual-firefox-installation' };
}
