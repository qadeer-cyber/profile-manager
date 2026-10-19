// Frozen v0.4.0 schema from be575c770a8b76596e6bbcb9f8dda1b12cc79be0.
// The alpha upgrade test applies this list, not whatever migrations are current.
import crypto from 'crypto';

export const migrationsV040 = [
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
    } }
]
