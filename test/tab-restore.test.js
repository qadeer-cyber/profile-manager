import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DEFAULT_ADVANCED_SETTINGS, validateAdvancedSettings } from '../server/advanced-settings.js';
import {
  chooseLaunchUrls, eligibleTabUrl, readSavedTabs, snapshotTabUrls, writeSavedTabs, TAB_STATE_NAME,
} from '../server/tab-restore.js';

test('restoreTabs defaults off and rejects a non-boolean', () => {
  assert.equal(DEFAULT_ADVANCED_SETTINGS.preferences.restoreTabs, false);
  const enabled = validateAdvancedSettings({ preferences: { restoreTabs: true } });
  assert.equal(enabled.preferences.restoreTabs, true);
  assert.equal(validateAdvancedSettings({ preferences: { startupUrls: ['https://example.com/a'] } }).preferences.restoreTabs, false);
  assert.throws(() => validateAdvancedSettings({ preferences: { restoreTabs: 'yes' } }), /boolean/);
});

test('eligible tab URLs drop diagnostic, internal, loopback, and credential addresses', () => {
  assert.equal(eligibleTabUrl('https://example.com/path?q=1'), 'https://example.com/path?q=1');
  assert.equal(eligibleTabUrl(' http://example.org/ '), 'http://example.org/');
  assert.equal(eligibleTabUrl('https://user:secret@example.com/'), null);
  assert.equal(eligibleTabUrl('http://127.0.0.1:3000/api'), null);
  assert.equal(eligibleTabUrl('http://localhost/admin'), null);
  assert.equal(eligibleTabUrl('chrome://settings'), null);
  assert.equal(eligibleTabUrl('devtools://devtools/bundled/inspector.html'), null);
  assert.equal(eligibleTabUrl('about:blank'), null);
  assert.equal(eligibleTabUrl('data:text/html,pm-diagnostics-v1'), null);
  assert.equal(eligibleTabUrl('https://example.com/pm-diagnostics-v1'), null);
  assert.equal(eligibleTabUrl('file:///tmp/secret'), null);
  assert.equal(eligibleTabUrl('javascript:alert(1)'), null);
});

test('startup URL and an explicit launch URL take priority over saved tabs', () => {
  const saved = ['https://example.com/old', 'https://example.org/old'];
  assert.deepEqual(chooseLaunchUrls({ explicitUrl: 'https://example.com/now', startupUrls: ['https://example.com/startup'], savedUrls: saved }), ['https://example.com/now']);
  assert.deepEqual(chooseLaunchUrls({ explicitUrl: '', startupUrls: ['https://example.com/startup'], savedUrls: saved }), ['https://example.com/startup']);
  assert.deepEqual(chooseLaunchUrls({ savedUrls: saved }), saved);
  assert.deepEqual(chooseLaunchUrls({}), []);
});

test('corrupt tab state is ignored and profiles do not share a file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-tabs-'));
  const a = path.join(root, 'a');
  const b = path.join(root, 'b');
  fs.mkdirSync(a);
  fs.mkdirSync(b);
  assert.deepEqual(readSavedTabs(a), { urls: [], corrupt: false });
  fs.writeFileSync(path.join(a, TAB_STATE_NAME), '{');
  assert.deepEqual(readSavedTabs(a), { urls: [], corrupt: true });
  const saved = writeSavedTabs(a, [
    'https://example.com/one',
    'https://user:pw@example.com/hidden',
    'https://example.org/two',
    'https://example.com/one',
    'chrome://newtab',
  ]);
  assert.deepEqual(saved, ['https://example.com/one', 'https://example.org/two']);
  assert.deepEqual(readSavedTabs(a).urls, saved);
  assert.deepEqual(readSavedTabs(b).urls, []);
  const pages = [
    { url: () => 'https://example.com/one', isClosed: () => false },
    { url: () => 'about:blank', isClosed: () => false },
    { url: () => 'https://example.org/two', isClosed: () => true },
  ];
  assert.deepEqual(snapshotTabUrls(pages), ['https://example.com/one']);
  assert.equal(snapshotTabUrls([]), null);
  assert.deepEqual(snapshotTabUrls([{ url: () => 'about:blank', isClosed: () => false }]), []);
});
