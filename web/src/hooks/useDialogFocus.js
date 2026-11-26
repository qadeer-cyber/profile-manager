import { useEffect, useRef } from 'react';

// Shared modal focus behavior for Dialog and Drawer:
// - moves focus into the modal (unless a child already took it with autoFocus),
// - keeps Tab / Shift+Tab inside the topmost modal,
// - lets only the topmost modal handle Escape, so one Escape closes one layer,
// - returns focus to the element that was focused before the modal opened.
const stack = [];
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export const focusableIn = root => [...root.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement);
export const topModal = () => stack[stack.length - 1] || null;

export function useDialogFocus(onClose) {
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  // Record the opener during the first render: React applies autoFocus inside the modal before
  // effects run, so reading document.activeElement in the effect would return the modal's own field.
  const openerRef = useRef(undefined);
  if (openerRef.current === undefined) openerRef.current = typeof document === 'undefined' ? null : document.activeElement;
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const opener = openerRef.current;
    const entry = { node };
    stack.push(entry);
    if (!node.contains(document.activeElement)) (focusableIn(node).find(el => !el.matches('.card-head button, .drawer-head button')) || focusableIn(node)[0] || node).focus();
    const onKey = event => {
      if (stack[stack.length - 1] !== entry) return;
      if (event.key === 'Escape') {
        if (event.defaultPrevented) return;
        event.preventDefault();
        close.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusableIn(node);
      if (!items.length) { event.preventDefault(); node.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const at = stack.indexOf(entry);
      if (at >= 0) stack.splice(at, 1);
      // Restore only when focus would otherwise be lost (it was inside the modal or on <body>).
      const active = document.activeElement;
      if (opener && opener.isConnected && typeof opener.focus === 'function' && (!active || active === document.body || node.contains(active))) opener.focus();
    };
  }, []);
  return ref;
}
