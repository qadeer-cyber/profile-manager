import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import {
  readProfileBookmarks, readProfileHistory, assertProfileStoppedForDiskExport,
} from '../server/profile-browser-export.js';

test('bookmarks export flattens Chromium JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-bm-'));
  const def = path.join(dir, 'Default');
  fs.mkdirSync(def, { recursive: true });
  fs.writeFileSync(path.join(def, 'Bookmarks'), JSON.stringify({
    roots: {
      bookmark_bar: {
        type: 'folder',
        name: 'Bookmarks bar',
        children: [{ type: 'url', name: 'Example', url: 'https://example.com/', date_added: '1' }],
      },
    },
  }));
  const out = readProfileBookmarks(dir);
  assert.equal(out.availability, 'available');
  assert.equal(out.bookmarks.length, 1);
  assert.equal(out.bookmarks[0].url, 'https://example.com/');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('history export reads visits when stopped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-hist-'));
  const def = path.join(dir, 'Default');
  fs.mkdirSync(def, { recursive: true });
  const db = new Database(path.join(def, 'History'));
  db.exec(`CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT);
CREATE TABLE visits (id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER, visit_duration INTEGER);`);
  db.prepare('INSERT INTO urls (id, url, title) VALUES (1, ?, ?)').run('https://a.test/', 'A');
  db.prepare('INSERT INTO visits (url, visit_time, visit_duration) VALUES (1, ?, 0)').run(13000000000000000);
  db.close();
  const out = readProfileHistory(dir, { limit: 10 });
  assert.equal(out.availability, 'available');
  assert.equal(out.entries.length, 1);
  assert.equal(out.entries[0].url, 'https://a.test/');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('assertProfileStoppedForDiskExport rejects running profile', () => {
  assert.throws(
    () => assertProfileStoppedForDiskExport(() => true, 'x'),
    err => err.code === 'PROFILE_RUNNING',
  );
});
