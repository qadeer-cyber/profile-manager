// Items that need the user's attention on the Profiles page. Pure (no React). Every item comes from a real count in
// /api/meta; the fleet header already shows failed-proxy counts, so they are not repeated here.
export function attentionItems({ errorCount = 0, recoveryPendingCount = 0 } = {}) {
  const items = [];
  if (recoveryPendingCount > 0) {
    items.push({ id: 'recovery', tone: 'warn', action: 'diagnostics', actionLabel: 'Open Diagnostics',
      text: recoveryPendingCount === 1 ? 'An interrupted data operation needs your decision.' : `${recoveryPendingCount} interrupted data operations need your decision.`,
      detail: 'A restore, purge or backup transfer did not finish. Nothing is deleted or retried automatically; review it in Diagnostics.' });
  }
  if (errorCount > 0) {
    items.push({ id: 'errors', tone: 'warn', action: 'show-errors', actionLabel: 'Show them',
      text: errorCount === 1 ? 'A profile stopped with an error.' : `${errorCount} profiles stopped with an error.`,
      detail: 'The browser closed unexpectedly or could not start. Launch the profile again; if it keeps happening, open Diagnostics.' });
  }
  return items;
}

// A dismissed banner stays hidden until the situation gets worse (any count goes up) or changes shape.
export const attentionSignature = items => items.map(i => i.id + ':' + i.text).join('|');
export function bannerVisible(items, dismissedSignature) {
  return items.length > 0 && attentionSignature(items) !== dismissedSignature;
}
