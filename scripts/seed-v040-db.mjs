// Build a synthetic v0.4.0 database for the alpha upgrade test.
// Uses the frozen be575c7 migrations and never reads a real user's data.
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import Database from 'better-sqlite3';
import { chromium } from 'playwright';
import { migrate } from '../server/migrations.js';
import { migrationsV040 } from '../test/fixtures/schema-v0.4.0.mjs';

const dataDir = process.env.PM_DATA_DIR || (process.env.APPDATA ? path.join(process.env.APPDATA, 'profile-manager', 'data') : '');
if (!dataDir) {
  console.error('PM_DATA_DIR or APPDATA is required');
  process.exit(1);
}
fs.mkdirSync(path.join(dataDir, 'profiles'), { recursive: true });

const key = crypto.randomBytes(32);
fs.writeFileSync(path.join(dataDir, 'secret.key'), key.toString('base64'), { mode: 0o600 });
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return `enc:v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

const dbFile = path.join(dataDir, 'profiles.db');
fs.rmSync(dbFile, { force: true });
fs.rmSync(dbFile + '-wal', { force: true });
fs.rmSync(dbFile + '-shm', { force: true });
const db = new Database(dbFile);
const migrated = migrate(db, migrationsV040);
if (migrated.to !== 6) throw new Error('v0.4.0 seed ended at schema ' + migrated.to);
const now = new Date().toISOString();
const proxyId = crypto.randomUUID();
const profileId = crypto.randomUUID();
const password = 'alpha-secret';
db.prepare('INSERT INTO proxies (id,name,type,host,port,username,password,tags,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
  .run(proxyId, 'LegacyProxy', 'http', '203.0.113.10', 8080, 'legacy-user', encrypt(password), '[]', now, now);
db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at,automation_enabled,proxy_id) VALUES (?,?,?,?,?,?,?,?,?)')
  .run(profileId, 'Legacy', '[]', '', 'seeded from the v0.4.0 schema', now, now, 0, proxyId);
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();

const server = http.createServer((_req, res) => res.end('<title>legacy</title>ok'));
const port = await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const origin = `http://127.0.0.1:${port}/`;
const dir = path.join(dataDir, 'profiles', profileId);
const ctx = await chromium.launchPersistentContext(dir, {
  headless: true, timeout: 30000, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
});
try {
  const page = await ctx.newPage();
  await page.goto(origin);
  await page.evaluate(() => {
    localStorage.setItem('who', 'legacy');
    document.cookie = 'who=legacy; max-age=86400; path=/';
  });
} finally {
  await ctx.close();
  server.close();
}

const expect = { id: profileId, name: 'Legacy', proxyName: 'LegacyProxy', password, port, localStorage: 'legacy', cookie: 'who=legacy' };
fs.writeFileSync(path.join(dataDir, 'upgrade-expect.json'), JSON.stringify(expect));
console.log(`seeded v0.4.0 schema at ${dbFile} profile ${profileId} origin ${origin}`);
