// Firefox extension library (signed unpacked or XPI). Does not bypass Mozilla signing requirements.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db, DATA_DIR } from './db.js';
import { listZipEntries, readZipEntry, xpiHasMozillaSignature } from './gecko-xpi.js';

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

export function readGeckoManifestFromDir(dir) {
  const file = path.join(dir, 'manifest.json');
  if (!fs.existsSync(file)) invalid('manifest.json is required');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { invalid('manifest.json is not valid JSON'); }
  const gecko = manifest.browser_specific_settings?.gecko || manifest.applications?.gecko;
  if (!gecko?.id) invalid('Firefox extensions require browser_specific_settings.gecko.id (signed distribution id)');
  const name = typeof manifest.name === 'string' ? manifest.name.trim() : gecko.id;
  const version = typeof manifest.version === 'string' ? manifest.version : '0.0.0';
  return {
    geckoId: String(gecko.id),
    name: name.slice(0, 128) || gecko.id,
    version: version.slice(0, 32),
    manifestVersion: manifest.manifest_version === 3 ? 3 : 2,
    strictSigning: gecko.strict_min_version != null,
  };
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
  const buf = fs.readFileSync(xpiPath);
  if (!xpiHasMozillaSignature(buf)) invalid('XPI must include META-INF/mozilla.rsa or mozilla.sf (Mozilla signing metadata)', 400, 'GECKO_UNSIGNED');
  const manifestBuf = readZipEntry(buf, 'manifest.json');
  const manifest = JSON.parse(manifestBuf.toString('utf8'));
  const gecko = manifest.browser_specific_settings?.gecko || manifest.applications?.gecko;
  if (!gecko?.id) invalid('manifest must include gecko.id');
  const meta = {
    geckoId: String(gecko.id),
    name: String(manifest.name || gecko.id).slice(0, 128),
    version: String(manifest.version || '0.0.0').slice(0, 32),
    manifestVersion: manifest.manifest_version === 3 ? 3 : 2,
  };
  const rel = `gecko-extensions/${crypto.randomUUID()}`;
  const dest = geckoStoragePath(rel);
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'extension.xpi'), buf);
  fs.writeFileSync(path.join(dest, 'manifest.json'), manifestBuf);
  return insertGeckoExtensionRow(meta, rel);
}

export function importUnpackedGeckoExtension(sourcePath) {
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) invalid('path must be an absolute directory');
  const root = fs.realpathSync(sourcePath);
  if (!fs.statSync(root).isDirectory()) invalid('path must be a directory');
  const meta = readGeckoManifestFromDir(root);
  const rel = `gecko-extensions/${crypto.randomUUID()}`;
  const dest = geckoStoragePath(rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(root, dest, { recursive: true, errorOnExist: true });
  return insertGeckoExtensionRow(meta, rel);
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
  const file = path.join(profileDir, 'extensions.json');
  if (!fs.existsSync(file)) invalid('extensions.json not found in gecko profile (launch Firefox once)', 404, 'GECKO_EXTENSIONS_JSON_MISSING');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const addons = Array.isArray(data.addons) ? data.addons : [];
  let found = false;
  for (const addon of addons) {
    if (addon.id === geckoId) {
      addon.userDisabled = !enabled;
      addon.active = enabled;
      found = true;
    }
  }
  if (!found) invalid('Extension id not found in extensions.json', 404, 'GECKO_EXTENSION_NOT_FOUND');
  fs.writeFileSync(file, JSON.stringify({ ...data, addons }, null, 2));
  return { id: geckoId, enabled };
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
    signingPolicy: 'Mozilla signed extensions only; xpinstall signatures are not disabled.',
    importFormats: ['unpacked directory with manifest.json', 'signed .xpi (store/uncompressed manifest in test fixtures)'],
    note: 'Assign to Firefox profiles; copies are materialized into the gecko profile tree on launch.',
  };
}

/** Copy enabled Firefox extension assignments into the gecko profile directory. */
export function materializeGeckoExtensions(profileDir, profileId) {
  const rows = db.prepare(`SELECT e.*, pe.enabled FROM extensions e
    JOIN profile_extensions pe ON pe.extension_id = e.id
    WHERE pe.profile_id = ? AND e.browser_engine = 'firefox' ORDER BY e.id`).all(profileId);
  if (!rows.length) return { count: 0 };
  const extRoot = path.join(profileDir, 'extensions');
  fs.mkdirSync(extRoot, { recursive: true });
  let count = 0;
  for (const row of rows) {
    if (!row.enabled) continue;
    const src = geckoStoragePath(row.storage_dir);
    if (!fs.existsSync(path.join(src, 'manifest.json'))) continue;
    const dest = path.join(extRoot, row.gecko_extension_id);
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    count++;
  }
  return { count };
}
