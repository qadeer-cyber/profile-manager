import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DEFAULT_ADVANCED_SETTINGS } from './advanced-settings.js';
// Versioned schema migrations. Each migration runs once, in order, inside a transaction.
// Versions 1-6 are the v0.4.0 schema (be575c770a8b76596e6bbcb9f8dda1b12cc79be0).
// Later versions are additive: they add objects and do not rewrite or delete profile rows.
// Migrations 1-2 use IF NOT EXISTS so databases created before versioning existed
// (which already have these tables) are adopted without data loss.
export const migrations = [
  { version: 1, name: 'profiles table', up: db => db.exec(`CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
      folder TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      proxy TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`) },
  { version: 2, name: 'running table', up: db => db.exec(`CREATE TABLE IF NOT EXISTS running (
      id TEXT PRIMARY KEY, pid INTEGER, cdp_port INTEGER, ws_endpoint TEXT, relay_url TEXT, started_at TEXT NOT NULL)`) },
  { version: 3, name: 'settings table', up: db => db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`) },
  { version: 4, name: 'profile launch status columns', up: db => {
      const cols = db.prepare('PRAGMA table_info(profiles)').all().map(c => c.name);
      if (!cols.includes('last_launched_at')) db.exec('ALTER TABLE profiles ADD COLUMN last_launched_at TEXT');
      if (!cols.includes('last_error')) db.exec('ALTER TABLE profiles ADD COLUMN last_error TEXT');
      db.exec('CREATE INDEX IF NOT EXISTS idx_profiles_folder ON profiles(folder)');
    } },
  { version: 5, name: 'profiles.automation_enabled', up: db => {
      const cols = db.prepare('PRAGMA table_info(profiles)').all().map(c => c.name);
      if (!cols.includes('automation_enabled')) db.exec('ALTER TABLE profiles ADD COLUMN automation_enabled INTEGER NOT NULL DEFAULT 0');
    } },
  { version: 6, name: 'proxy library + profiles.proxy_id (inline proxies migrated)', up: db => {
      db.exec(`CREATE TABLE IF NOT EXISTS proxies (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('http','https','socks5')),
        host TEXT NOT NULL, port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
        username TEXT NOT NULL DEFAULT '', password TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        last_test_status TEXT CHECK (last_test_status IN ('ok','failed')), last_test_ip TEXT,
        last_test_latency_ms INTEGER, last_test_error TEXT, last_tested_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_proxies_endpoint ON proxies(type, host, port, username)');
      const cols = db.prepare('PRAGMA table_info(profiles)').all().map(c => c.name);
      if (!cols.includes('proxy_id')) db.exec('ALTER TABLE profiles ADD COLUMN proxy_id TEXT REFERENCES proxies(id) ON DELETE SET NULL');
      // Move inline proxies into the library. Ciphertext is copied as-is (no decryption here);
      // profiles with an identical endpoint + stored password share one row.
      const now = new Date().toISOString();
      const find = db.prepare('SELECT id FROM proxies WHERE type=? AND host=? AND port=? AND username=? AND password=?');
      const ins = db.prepare('INSERT INTO proxies (id,name,type,host,port,username,password,tags,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
      const link = db.prepare('UPDATE profiles SET proxy_id=?, proxy=NULL WHERE id=?');
      for (const r of db.prepare('SELECT id, proxy FROM profiles WHERE proxy IS NOT NULL AND proxy_id IS NULL').all()) {
        let px; try { px = JSON.parse(r.proxy); } catch { continue; }
        if (!px || !px.host || !['http', 'https', 'socks5'].includes(px.type)) continue;
        const port = Number(px.port); if (!(port >= 1 && port <= 65535)) continue;
        const u = String(px.username || ''), pw = String(px.password || '');
        let pid = find.get(px.type, String(px.host), port, u, pw)?.id;
        if (!pid) { pid = crypto.randomUUID(); ins.run(pid, `${px.type}://${px.host}:${port}`, px.type, String(px.host), port, u, pw, '[]', now, now); }
        link.run(pid, r.id);
      }
    } },
  { version: 7, name: 'profiles updated_at index', up: db => {
      db.exec('CREATE INDEX IF NOT EXISTS idx_profiles_updated_at ON profiles(updated_at)');
    } },
  { version: 8, name: 'per-profile browser regional settings', up: db => {
      db.exec(`ALTER TABLE profiles ADD COLUMN browser_settings TEXT NOT NULL DEFAULT '{"locale":"","timezoneId":"","languages":[]}'`);
    } },
  { version: 9, name: 'per-profile WebRTC policy', up: db => {
      db.exec(`ALTER TABLE profiles ADD COLUMN webrtc_settings TEXT NOT NULL DEFAULT '{"mode":"browser_default"}'`);
    } },
  { version: 10, name: 'extension library and profile assignments', up: db => {
      db.exec(`CREATE TABLE extensions (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '', manifest_version INTEGER NOT NULL,
        permissions TEXT NOT NULL DEFAULT '[]', host_permissions TEXT NOT NULL DEFAULT '[]',
        optional_permissions TEXT NOT NULL DEFAULT '[]', optional_host_permissions TEXT NOT NULL DEFAULT '[]',
        storage_dir TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
      db.exec(`CREATE TABLE profile_extensions (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        extension_id TEXT NOT NULL REFERENCES extensions(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (profile_id, extension_id))`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_profile_extensions_extension ON profile_extensions(extension_id)');
    } },
  { version: 11, name: 'per-profile advanced browser settings', up: db => {
      const defaults = JSON.stringify(DEFAULT_ADVANCED_SETTINGS).replaceAll("'", "''");
      db.exec(`ALTER TABLE profiles ADD COLUMN advanced_settings TEXT NOT NULL DEFAULT '${defaults}'`);
    } },
  { version: 12, name: 'saved views, proxy check history, provider accounts, bulk jobs', up: db => {
      db.exec(`CREATE TABLE saved_views (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        surface TEXT NOT NULL DEFAULT 'profiles',
        query_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL)`);
      db.exec(`CREATE TABLE proxy_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proxy_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ok','failed')),
        latency_ms INTEGER,
        error TEXT,
        tested_at TEXT NOT NULL)`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_proxy_checks_proxy ON proxy_checks(proxy_id, tested_at)');
      db.exec(`CREATE TABLE provider_accounts (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        label TEXT NOT NULL,
        secret TEXT NOT NULL DEFAULT '',
        api_token TEXT NOT NULL DEFAULT '',
        config TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL)`);
      db.exec(`CREATE TABLE bulk_jobs (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        total INTEGER NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        summary TEXT NOT NULL DEFAULT '[]',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL)`);
      const cols = db.prepare('PRAGMA table_info(proxies)').all().map(column => column.name);
      if (!cols.includes('provider')) db.exec('ALTER TABLE proxies ADD COLUMN provider TEXT');
      if (!cols.includes('provider_ref')) db.exec('ALTER TABLE proxies ADD COLUMN provider_ref TEXT');
      if (!cols.includes('provider_meta')) db.exec("ALTER TABLE proxies ADD COLUMN provider_meta TEXT NOT NULL DEFAULT '{}'");
    } },
  { version: 13, name: 'profiles.browser_engine chromium|firefox', up: db => {
      const cols = db.prepare('PRAGMA table_info(profiles)').all().map(c => c.name);
      if (!cols.includes('browser_engine')) {
        db.exec(`ALTER TABLE profiles ADD COLUMN browser_engine TEXT NOT NULL DEFAULT 'chromium' CHECK (browser_engine IN ('chromium','firefox'))`);
      }
    } },
  { version: 14, name: 'profiles quick flag and trash', up: db => {
      const cols = db.prepare('PRAGMA table_info(profiles)').all().map(c => c.name);
      if (!cols.includes('is_quick')) db.exec('ALTER TABLE profiles ADD COLUMN is_quick INTEGER NOT NULL DEFAULT 0');
      if (!cols.includes('deleted_at')) db.exec('ALTER TABLE profiles ADD COLUMN deleted_at TEXT');
      db.exec('CREATE INDEX IF NOT EXISTS idx_profiles_deleted_at ON profiles(deleted_at)');
    } },
  { version: 15, name: 'profile_templates library', up: db => {
      db.exec(`CREATE TABLE IF NOT EXISTS profile_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL)`);
    } },
  { version: 16, name: 'local workspaces and cookie robot jobs', up: db => {
      db.exec(`CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        vault_locked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL)`);
      db.exec(`CREATE TABLE IF NOT EXISTS cookie_robot_jobs (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        status TEXT NOT NULL,
        tasks_json TEXT NOT NULL,
        delay_ms INTEGER NOT NULL DEFAULT 1500,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL)`);
      const cols = db.prepare('PRAGMA table_info(profiles)').all().map(c => c.name);
      if (!cols.includes('workspace_id')) db.exec('ALTER TABLE profiles ADD COLUMN workspace_id TEXT REFERENCES workspaces(id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_profiles_workspace ON profiles(workspace_id)');
    } },
  { version: 17, name: 'profiles purge_error for recovery-safe trash purge', up: db => {
      const cols = db.prepare('PRAGMA table_info(profiles)').all().map(c => c.name);
      if (!cols.includes('purge_error')) db.exec('ALTER TABLE profiles ADD COLUMN purge_error TEXT');
    } },
  { version: 18, name: 'extensions browser_engine and gecko id', up: db => {
      const cols = db.prepare('PRAGMA table_info(extensions)').all().map(c => c.name);
      if (!cols.includes('browser_engine')) {
        db.exec(`ALTER TABLE extensions ADD COLUMN browser_engine TEXT NOT NULL DEFAULT 'chromium' CHECK (browser_engine IN ('chromium','firefox'))`);
      }
      if (!cols.includes('gecko_extension_id')) db.exec('ALTER TABLE extensions ADD COLUMN gecko_extension_id TEXT');
    } },
  { version: 19, name: 'proxy traffic policies and measured sessions', up: db => {
      db.exec(`CREATE TABLE IF NOT EXISTS proxy_traffic_policies (
        proxy_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        block_extensions TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS proxy_traffic_sessions (
        id TEXT PRIMARY KEY,
        proxy_id TEXT,
        script_id TEXT NOT NULL,
        policy_json TEXT NOT NULL,
        origin_response_bytes INTEGER NOT NULL,
        origin_request_bytes INTEGER NOT NULL,
        blocked_requests INTEGER NOT NULL,
        forwarded_requests INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_proxy_traffic_sessions_script ON proxy_traffic_sessions(script_id, created_at)');
    } },
];

// Copy the database file before any pending migration changes it. The copy is the
// pre-migration bytes, so a failed upgrade can be put back by replacing profiles.db.
function backupBeforeMigrate(db, list) {
  const file = db.name;
  if (!file || file === ':memory:') return null;
  const from = currentVersion(db);
  if (!list.some(m => m.version > from)) return null;
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(path.dirname(file), `${path.basename(file)}.${stamp}.bak`);
  fs.copyFileSync(file, dest);
  return dest;
}

export function currentVersion(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT NOT NULL)');
  return db.prepare('SELECT COALESCE(MAX(version), 0) v FROM schema_version').get().v;
}

export function migrate(db, list = migrations) {
  const backup = backupBeforeMigrate(db, list);
  const from = currentVersion(db);
  const applied = [];
  for (const m of list.filter(m => m.version > from).sort((a, b) => a.version - b.version)) {
    db.transaction(() => {
      m.up(db);
      db.prepare('INSERT INTO schema_version VALUES (?,?,?)').run(m.version, m.name, new Date().toISOString());
    })();
    applied.push(m.version);
  }
  return { from, to: currentVersion(db), applied, backup };
}
