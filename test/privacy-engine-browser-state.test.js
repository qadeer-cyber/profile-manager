import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openBrowserState } from '../engine-prototype/browser-state.js';

test('browser records persist in their profile and reject unsafe URLs on restoration', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-browser-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const other = path.join(root, 'second');
  fs.mkdirSync(other);
  const first = openBrowserState(root);
  first.update({
    tabs: ['https://example.com/', 'file:///C:/private'],
    bookmarks: ['https://example.org/', 'https://user:secret@example.org/'],
    history: ['https://example.com/', 'http://example.com/'],
  });
  assert.deepEqual(openBrowserState(root).state, {
    tabs: ['https://example.com/'], bookmarks: ['https://example.org/'], history: ['https://example.com/'],
  });
  assert.deepEqual(openBrowserState(other).state, { tabs: [], bookmarks: [], history: [] });
});
