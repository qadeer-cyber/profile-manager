import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { harvestChromiumTabUrls, harvestFirefoxTabUrls } from '../server/session-harvest.js';
import { writeSavedTabs, readSavedTabs } from '../server/tab-restore.js';

test('harvestChromiumTabUrls finds http(s) URLs in Preferences JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-harv-'));
  fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Default', 'Preferences'), JSON.stringify({ tabs: [{ url: 'https://example.com/a' }] }));
  const urls = harvestChromiumTabUrls(dir);
  assert.ok(urls.includes('https://example.com/a'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('harvestFirefoxTabUrls reads sessionstore.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-harv-ff-'));
  fs.writeFileSync(path.join(dir, 'sessionstore.json'), JSON.stringify({
    windows: [{ tabs: [{ entries: [{ url: 'https://example.org/b' }] }] }],
  }));
  const urls = harvestFirefoxTabUrls(dir);
  assert.ok(urls.includes('https://example.org/b'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeSavedTabs round trip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-tabs-'));
  writeSavedTabs(dir, ['https://example.com/x', 'http://127.0.0.1/loopback']);
  const saved = readSavedTabs(dir);
  assert.deepEqual(saved.urls, ['https://example.com/x']);
  fs.rmSync(dir, { recursive: true, force: true });
});
