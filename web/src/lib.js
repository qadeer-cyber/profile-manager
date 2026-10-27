// Run fn over items with limited concurrency; resolves to {ok, failed:[{item, error}]}.
export async function runAll(items, fn, limit = 3) {
  const failed = []; let i = 0, ok = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const it = items[i++]; try { await fn(it); ok++; } catch (e) { failed.push({ item: it, error: e.message }); } }
  }));
  return { ok, failed };
}
export const statusOf = p => p.running ? 'running' : p.last_error ? 'error' : 'stopped';
// Row status for display. While a launch is in flight the row shows Starting and hides the previous
// error; the server clears last_error when the launch succeeds and sets a new one when it fails.
export function rowStatus(p, busy) {
  if (busy && !p.running) return { key: 'stopped', label: 'Starting', showError: false };
  const key = statusOf(p);
  return { key, label: key[0].toUpperCase() + key.slice(1), showError: key === 'error' };
}
// Plain-language summary of a crash message from the server. Callers keep the raw message
// visible as a tooltip so the diagnostic detail is never hidden.
export function crashSummary(raw) {
  const s = String(raw || '').trim();
  if (/detected by health monitor/i.test(s)) return 'The browser process was ended outside Profile Manager (for example from Task Manager). Launch the profile again.';
  if (/^Browser exited unexpectedly|exit_type (Crashed|missing|unreadable)/i.test(s)) return 'The browser closed unexpectedly (it crashed or another program ended it). Launch the profile again; if it keeps happening, open Diagnostics.';
  return s || 'The browser closed unexpectedly.';
}
// Returns a function that reports true the first time a key is seen within ms, false for repeats.
export function makeDedupe(ms, now = () => Date.now()) {
  const seen = new Map();
  return key => {
    const t = now();
    for (const [k, at] of seen) if (t - at >= ms) seen.delete(k);
    if (seen.has(key)) return false;
    seen.set(key, t); return true;
  };
}
// Profile lifecycle events refresh the profile list immediately.
export const refreshesNow = e => typeof e?.type === 'string' && e.type.startsWith('profile:');
// Dedupe key for a toast. A server event key (type, profile id, timestamp) makes each real
// failure distinct, so only a re-delivery of the same event is collapsed.
export const toastKey = (kind, msg, key) => key ? `${kind}\u0000ev\u0000${key}` : `${kind}\u0000${msg}`;
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
