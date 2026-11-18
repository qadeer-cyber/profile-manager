import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { readGeckoProfileCookies, exportGeckoCookiesPayload, geckoCookieDbPath } from '../server/gecko-cookies.js';

function seedGeckoDb(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(geckoCookieDbPath(dir));
  db.exec(`CREATE TABLE moz_cookies (
    id INTEGER PRIMARY KEY,
    originAttributes TEXT NOT NULL DEFAULT '',
    name TEXT,
    value TEXT,
    host TEXT,
    path TEXT,
    expiry INTEGER,
    lastAccessed INTEGER,
    creationTime INTEGER,
    isSecure INTEGER,
    isHttpOnly INTEGER,
    inBrowserElement INTEGER DEFAULT 0,
    sameSite INTEGER DEFAULT 0
  );`);
  db.prepare('INSERT INTO moz_cookies (name,value,host,path,expiry,isSecure,isHttpOnly,sameSite) VALUES (?,?,?,?,?,?,?,?)')
    .run('sid', 'secret', '.example.com', '/app', 4102444800, 1, 1, 2);
  db.close();
}

test('readGeckoProfileCookies reads moz_cookies when profile is stopped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-gecko-cook-'));
  seedGeckoDb(dir);
  const cookies = readGeckoProfileCookies(dir);
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].name, 'sid');
  assert.equal(cookies[0].value, 'secret');
  assert.equal(cookies[0].sameSite, 'Strict');
  assert.equal(cookies[0].secure, true);
  const payload = exportGeckoCookiesPayload(cookies);
  assert.equal(payload.engine, 'firefox');
  assert.equal(payload.readOnly, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('missing gecko cookie db returns empty list', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-gecko-empty-'));
  assert.deepEqual(readGeckoProfileCookies(dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});
