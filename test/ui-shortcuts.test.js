import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortcutAllowed, isEditableTarget, overlayOpen } from '../web/src/lib/shortcuts.js';

const el = matches => ({ closest: sel => (matches && sel.includes(matches) ? {} : null), isContentEditable: false });
const doc = hits => ({ querySelector: sel => (hits ? {} : null) });
const ev = (over = {}) => ({ key: 'n', target: el(null), defaultPrevented: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...over });

test('plain key on the page is allowed', () => assert.equal(shortcutAllowed(ev(), doc(false)), true));
test('modifier combinations are left to the browser and OS', () => {
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) assert.equal(shortcutAllowed(ev({ [mod]: true }), doc(false)), false, mod);
});
test('typing in fields never triggers shortcuts', () => {
  for (const tag of ['input', 'textarea', 'select', 'contenteditable']) assert.equal(shortcutAllowed(ev({ target: el(tag) }), doc(false)), false, tag);
  assert.equal(isEditableTarget({ closest: () => null, isContentEditable: true }), true);
  assert.equal(isEditableTarget(null), false);
});
test('open dialogs and menus suppress page shortcuts', () => {
  assert.equal(shortcutAllowed(ev(), doc(true)), false);
  assert.equal(overlayOpen(doc(false)), false);
});
test('already handled or IME composition events are ignored', () => {
  assert.equal(shortcutAllowed(ev({ defaultPrevented: true }), doc(false)), false);
  assert.equal(shortcutAllowed(ev({ isComposing: true }), doc(false)), false);
});
