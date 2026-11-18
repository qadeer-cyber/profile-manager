import './_isolated-data.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { geckoUserDataDir } from '../server/browser-runtime/firefox-launch.js';
import { geckoCookieDbPath } from '../server/gecko-cookies.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ff-cookies-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'ff-cookies';
const { startServer } = await import('../server/app.js');
let server;
const call = async (method, url, payload) => {
  const response = await fetch(server.url + url, { method, headers: { Authorization: 'Bearer ff-cookies', 'Content-Type': 'application/json' }, body: payload == null ? undefined : JSON.stringify(payload) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};
before(async () => { server = await startServer({ port: 0, staticDir: null }); });
after(async () => {
  await server.close();
  try { const { db } = await import('../server/db.js'); db.close(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  delete process.env.PM_DATA_DIR;
});

async function seedGeckoCookies(profileId) {
  const { userDataDir } = await import('../server/db.js');
  const geckoDir = geckoUserDataDir(profileId, userDataDir);
  fs.mkdirSync(geckoDir, { recursive: true });
  const db = new Database(geckoCookieDbPath(geckoDir));
  db.exec(`CREATE TABLE moz_cookies (
    id INTEGER PRIMARY KEY, originAttributes TEXT DEFAULT '', name TEXT, value TEXT, host TEXT, path TEXT,
    expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER DEFAULT 1
  );`);
  db.prepare('INSERT INTO moz_cookies (name,value,host,path,expiry,isSecure,isHttpOnly,sameSite) VALUES (?,?,?,?,?,?,?,?)')
    .run('token', 'abc', 'example.org', '/', 0, 0, 0, 1);
  db.close();
}

test('stopped Firefox profile lists gecko cookies read-only', async () => {
  const created = await call('POST', '/api/v1/profiles', { name: 'FF cookies', browserEngine: 'firefox' });
  assert.equal(created.status, 201);
  await seedGeckoCookies(created.body.id);
  const list = await call('GET', `/api/v1/profiles/${created.body.id}/cookies`);
  assert.equal(list.status, 200);
  assert.equal(list.body.engine, 'firefox');
  assert.equal(list.body.readOnly, true);
  assert.equal(list.body.cookies.length, 1);
  assert.equal(list.body.cookies[0].value, 'abc');
  const exp = await call('GET', `/api/v1/profiles/${created.body.id}/cookies/export`);
  assert.equal(exp.status, 200);
  assert.equal(exp.body.engine, 'firefox');
  assert.equal(exp.body.cookies.length, 1);
});

test('Firefox cookie import returns FIREFOX_COOKIES_READ_ONLY', async () => {
  const created = await call('POST', '/api/v1/profiles', { name: 'FF no import', browserEngine: 'firefox' });
  const imp = await call('POST', `/api/v1/profiles/${created.body.id}/cookies/import`, { version: 1, cookies: [{ name: 'a', value: 'b', domain: '.x.com', path: '/', secure: true, httpOnly: false, sameSite: 'Lax' }] });
  assert.equal(imp.status, 501);
  assert.equal(imp.body.code, 'FIREFOX_COOKIES_READ_ONLY');
});
