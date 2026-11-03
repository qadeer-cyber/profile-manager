// Permanent installation is delegated to Firefox's AddonManager, including Mozilla
// signing roots, certificate chains and version compatibility policy.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, DATA_DIR, userDataDir } from './db.js';
import { assertProfileOperationAvailable } from './recovery-journal.js';
import { assertWorkspaceAccess } from './workspaces.js';
import { validateXpiArchive, XPI_LIMITS } from './gecko-xpi.js';
import { readGeckoProfileExtensions } from './gecko-extensions.js';
import { connectMarionette } from './marionette-client.js';
import { firefoxSessionIdentity } from './firefox-session.js';
const busy = new Set();
const fail = (message, code = 'GECKO_INSTALL_REJECTED', status = 409) => Object.assign(new Error(message), { code, status });
export function validatePermanentXpi(bytes, expectedId) {
  const entries = validateXpiArchive(bytes);
  const manifest = JSON.parse(entries.get('manifest.json')?.toString() || 'null');
  const id = manifest?.browser_specific_settings?.gecko?.id || manifest?.applications?.gecko?.id;
  if (id !== expectedId) throw fail('XPI identity changed; import it again.');
  const names = new Map([...entries].map(([name, data]) => [name.toLowerCase(), data]));
  const has = name => names.get(name)?.length > 0;
  if (!((has('meta-inf/mozilla.rsa') && has('meta-inf/mozilla.sf')) || (has('meta-inf/cose.sig') && has('meta-inf/cose.manifest')))) throw fail('Permanent installation requires a Mozilla-signed XPI. Unpacked and unsigned extensions are not installed.', 'GECKO_UNSIGNED');
  // Metadata is only a prerequisite; it is never treated as proof of a valid signature.
  return { id, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}
function targetProfile(id) {
  assertProfileOperationAvailable(id);
  const profile = db.prepare('SELECT * FROM profiles WHERE id=? AND deleted_at IS NULL').get(id);
  if (!profile || profile.browser_engine !== 'firefox') throw fail('Choose an active Firefox profile.', 'INVALID_PROFILE', 400);
  assertWorkspaceAccess(profile.workspace_id);
  const running = db.prepare('SELECT * FROM running WHERE id=?').get(id);
  if (!running?.cdp_port) throw fail('Launch this Firefox profile with automation enabled before managing signed add-ons.', 'FIREFOX_AUTOMATION_REQUIRED');
  return { profile, running, dir: path.join(userDataDir(id), 'gecko') };
}
function checkedXpi(row) {
  if (!row || row.browser_engine !== 'firefox' || !/^gecko-extensions\/[0-9a-f-]{36}$/i.test(row.storage_dir)) throw fail('Firefox library item not found.', 'NOT_FOUND', 404);
  let current = DATA_DIR;
  for (const part of [...row.storage_dir.split('/'), 'extension.xpi']) { current = path.join(current, part); const st = fs.lstatSync(current); if (st.isSymbolicLink()) throw fail('Symlink extension paths are forbidden.'); }
  const st = fs.statSync(current); if (!st.isFile() || st.size > XPI_LIMITS.archive) throw fail('XPI size is invalid.');
  const validation = validatePermanentXpi(fs.readFileSync(current), row.gecko_extension_id);
  return { file: current, ...validation };
}
function strictProfile(dir) {
  for (const file of ['user.js', 'prefs.js']) {
    const name = path.join(dir, file); if (!fs.existsSync(name)) continue;
    const st = fs.lstatSync(name); if (!st.isFile() || st.isSymbolicLink() || st.size > 4 * 1024 * 1024) throw fail('Firefox preferences require review.');
    const text = fs.readFileSync(name, 'utf8');
    if (/user_pref\s*\(\s*["']xpinstall\.signatures\.required["']\s*,\s*false/.test(text) || /user_pref\s*\(\s*["']xpinstall\.signatures\.dev-root["']\s*,\s*true/.test(text)) throw fail('Firefox signing policy is weakened. Restore Mozilla signing enforcement and restart the profile.', 'GECKO_SIGNING_POLICY');
  }
}
async function sessionFor(id, action) {
  if (busy.has(id)) throw fail('Another add-on operation is active.', 'PROFILE_OPERATION_BUSY');
  const target = targetProfile(id); strictProfile(target.dir); busy.add(id); let client, created = false;
  try {
    client = await connectMarionette(target.running.cdp_port, 10000);
    const session = await client.command('WebDriver:NewSession', {}); created = true;
    firefoxSessionIdentity(session, target.dir, target.running.pid);
    return await action(client, target);
  } finally { if (created) await client.command('WebDriver:DeleteSession').catch(() => {}); client?.close(); busy.delete(id); }
}
async function observed(dir, id, installed, expected = {}) {
  const deadline = Date.now() + 6000;
  do {
    const report = readGeckoProfileExtensions(dir);
    if (report.corrupt) throw fail('Firefox extension database is unreadable; inspect about:addons.', 'GECKO_INSTALL_UNVERIFIED');
    const addon = report.addons.find(a => a.id === id);
    let packageMatches = false;
    if (installed && addon?.version === expected.version) {
      const file = path.join(dir, 'extensions', id + '.xpi');
      try { const st = fs.lstatSync(file); packageMatches = st.isFile() && !st.isSymbolicLink() && st.size <= XPI_LIMITS.archive && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === expected.sha256; } catch {}
    }
    if (installed ? packageMatches && addon?.signatureVerified && !addon.appDisabled && addon.active : !addon) return addon || { id, removed: true };
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw fail('Firefox completed the command, but persisted add-on state could not be verified. Inspect about:addons before retrying.', 'GECKO_INSTALL_UNVERIFIED');
}
export async function installGeckoExtension(profileId, extensionId, { confirm = false } = {}) {
  if (confirm !== true) throw fail('Confirm installation into this profile.', 'CONFIRM_REQUIRED', 400);
  const row = db.prepare('SELECT * FROM extensions WHERE id=?').get(extensionId), xpi = checkedXpi(row);
  return sessionFor(profileId, async (client, target) => {
    const result = await client.command('Addon:Install', { path: xpi.file, temporary: false });
    const id = result?.value ?? result;
    if (id !== xpi.id) throw fail('Firefox returned a different add-on identity.', 'GECKO_INSTALL_UNVERIFIED');
    const addon = await observed(target.dir, id, true, { version: row.version, sha256: xpi.sha256 });
    assertProfileOperationAvailable(profileId);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO profile_extensions (profile_id,extension_id,enabled,created_at,updated_at) VALUES (?,?,1,?,?) ON CONFLICT(profile_id,extension_id) DO UPDATE SET enabled=1,updated_at=excluded.updated_at').run(profileId, extensionId, now, now);
    return { profileId, addon, sha256: xpi.sha256, permanent: true, verifiedBy: 'firefox-addon-manager', restartVerified: false };
  });
}
export async function removeGeckoExtension(profileId, extensionId, { confirm = false } = {}) {
  if (confirm !== true) throw fail('Confirm removal from this profile.', 'CONFIRM_REQUIRED', 400);
  const row = db.prepare("SELECT * FROM extensions WHERE id=? AND browser_engine='firefox'").get(extensionId);
  if (!row) throw fail('Firefox library item not found.', 'NOT_FOUND', 404);
  return sessionFor(profileId, async (client, target) => {
    await client.command('Addon:Uninstall', { id: row.gecko_extension_id });
    await observed(target.dir, row.gecko_extension_id, false);
    db.prepare('DELETE FROM profile_extensions WHERE profile_id=? AND extension_id=?').run(profileId, extensionId);
    return { profileId, id: row.gecko_extension_id, removed: true };
  });
}
