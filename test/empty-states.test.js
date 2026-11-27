// Empty-table copy and actions (web/src/lib/emptyStates.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../web/src/lib/emptyStates.js';

test('a truly empty proxy library explains itself and offers add and import, with the bulk-create pointer', () => {
  const e = emptyState('proxies');
  assert.equal(e.title, 'No proxies yet.');
  assert.deepEqual(e.actions.map(a => [a.id, Boolean(a.primary)]), [['add', true], ['import', false]]);
  assert.match(e.text, /Bulk create from proxy list/);
});

test('filtered-empty tables say the filters match nothing and offer to clear them, for every kind', () => {
  for (const kind of ['proxies', 'templates', 'extensions']) {
    const e = emptyState(kind, { filtered: true });
    assert.match(e.title, /match these filters/);
    assert.deepEqual(e.actions.map(a => a.id), ['clear-filters']);
  }
  assert.match(emptyState('proxies', { filtered: true }).title, /^No proxies match/);
});

test('templates: with profiles it offers to create one; without, it points to the Profiles page and offers nothing it cannot do', () => {
  assert.deepEqual(emptyState('templates', { hasProfiles: true }).actions.map(a => a.id), ['create']);
  const none = emptyState('templates', { hasProfiles: false });
  assert.deepEqual(none.actions, []);
  assert.match(none.text, /create a profile first/);
});

test('extensions: the Chromium library offers Chromium import and points to the Firefox library, which warns that only signed extensions are installed', () => {
  assert.deepEqual(emptyState('extensions').actions.map(a => a.id), ['import-chromium']);
  assert.match(emptyState('extensions').text, /Firefox library below/);
  assert.match(emptyState('extensions').text, /manifest\.json/);
  assert.match(emptyState('gecko').text, /Unsigned extensions are not installed/);
  assert.deepEqual(emptyState('gecko').actions.map(a => a.id), ['import-gecko']);
});

test('an unknown kind is harmless', () => {
  assert.deepEqual(emptyState('whatever'), { title: 'Nothing here yet.', text: '', actions: [] });
});
