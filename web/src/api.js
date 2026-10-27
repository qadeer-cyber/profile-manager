// API client. In the desktop app the preload bridge provides a per-session UI token.
const token = window.pm?.uiToken;
export async function api(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(token && { 'X-UI-Token': token }) };
  const r = await fetch(url, { ...opts, headers, body: opts.body && JSON.stringify(opts.body) });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({ error: r.statusText }));
  if (!r.ok) {
    const e = Object.assign(new Error(j.message || j.error || `HTTP ${r.status}`), { status: r.status, code: j.code || (j.error === 'CHROMIUM_MISSING' ? j.error : undefined) });
    // Server sends 503 {error:'CHROMIUM_MISSING', message}; also accept {code:'CHROMIUM_MISSING'}.
    if (j.error === 'CHROMIUM_MISSING' || j.code === 'CHROMIUM_MISSING') dispatchEvent(new CustomEvent('pm:chromium-missing'));
    throw e;
  }
  return j;
}
// Server events (profile started/stopped/crashed, browser install)
export function subscribe(cb) {
  if (window.pm?.onEvent) return window.pm.onEvent(cb);
  const es = new EventSource('/api/events'); // web mode only; desktop uses the preload bridge (UI token is header-only)
  es.onmessage = m => cb(JSON.parse(m.data));
  return () => es.close();
}
