// Single-key app shortcuts ("/", "n", "g" then a letter) only act when the person is not typing,
// not holding a modifier (Ctrl+N, Ctrl+/ and friends belong to the browser/OS), and no modal
// dialog or menu is open on top of the page.
export function isEditableTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return !!(target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') || target.isContentEditable);
}
export function overlayOpen(doc = globalThis.document) {
  return !!doc?.querySelector?.('[role=dialog][aria-modal="true"], [role=menu]');
}
export function shortcutAllowed(event, doc = globalThis.document) {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return false;
  if (isEditableTarget(event.target)) return false;
  return !overlayOpen(doc);
}
