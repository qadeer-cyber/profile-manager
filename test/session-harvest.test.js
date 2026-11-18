import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  harvestChromiumTabUrls, harvestFirefoxTabUrls, mergeTabUrlLists, resolveNativeTabUrlsForSave,
} from '../server/session-harvest.js';
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

test('mergeTabUrlLists dedupes and respects order', () => {
  const merged = mergeTabUrlLists(['https://a.test/', 'http://127.0.0.1/x'], ['https://b.test/', 'https://a.test/']);
  assert.deepEqual(merged, ['https://a.test/', 'https://b.test/']);
});

test('resolveNativeTabUrlsForSave merges live harvest with pm-tabs snapshot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-resolve-'));
  fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Default', 'Preferences'), JSON.stringify({ seed: { url: 'https://live.example/' } }));
  writeSavedTabs(dir, ['https://saved.example/']);
  const urls = resolveNativeTabUrlsForSave({ engine: 'chromium', chromiumDir: dir, geckoDir: dir, existing: ['https://existing.example/'] });
  assert.ok(urls.includes('https://existing.example/'));
  assert.ok(urls.includes('https://live.example/'));
  assert.ok(urls.includes('https://saved.example/'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('resolveNativeTabUrlsForSave merges firefox and chromium dirs for firefox engine', () => {
  const chromiumDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ff-cr-'));
  const geckoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ff-gk-'));
  fs.mkdirSync(path.join(chromiumDir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(chromiumDir, 'Default', 'Preferences'), JSON.stringify({ tabs: [{ url: 'https://chromium-only.example/' }] }));
  fs.writeFileSync(path.join(geckoDir, 'sessionstore.json'), JSON.stringify({
    windows: [{ tabs: [{ entries: [{ url: 'https://firefox-only.example/' }] }] }],
  }));
  const urls = resolveNativeTabUrlsForSave({ engine: 'firefox', chromiumDir, geckoDir, existing: [] });
  assert.ok(urls.includes('https://chromium-only.example/'));
  assert.ok(urls.includes('https://firefox-only.example/'));
  fs.rmSync(chromiumDir, { recursive: true, force: true });
  fs.rmSync(geckoDir, { recursive: true, force: true });
});

test('writeSavedTabs round trip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-tabs-'));
  writeSavedTabs(dir, ['https://example.com/x', 'http://127.0.0.1/loopback']);
  const saved = readSavedTabs(dir);
  assert.deepEqual(saved.urls, ['https://example.com/x']);
  fs.rmSync(dir, { recursive: true, force: true });
});
