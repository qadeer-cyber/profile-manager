// API client. In the desktop app the preload bridge provides a per-session UI token.
const token = window.pm?.uiToken;
export async function api(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(token && { 'X-UI-Token': token }) };
  const r = await fetch(url, { ...opts, headers, body: opts.body && JSON.stringify(opts.body) });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({ error: r.statusText }));
  if (!r.ok) {
    const e = Object.assign(new Error(j.message || j.error || `HTTP ${r.status}`), { status: r.status, code: j.code || (j.error === 'CHROMIUM_MISSING' ? j.error : undefined) });
    // Owner-approved exception: preserve the diagnostics envelope only. Ordinary
    // transport, token retrieval, authorization and errors retain their behavior.
    if (/^\/api\/profiles\/[^/?]+\/diagnostics(?:\/environment)?\/?(?:\?|$)/.test(url)
        && j.error && typeof j.error === 'object') {
      const detail = j.error;
      if (['INVALID_REQUEST', 'UNAUTHORIZED', 'PROFILE_NOT_FOUND', 'LAUNCH_CHANGED', 'DIAGNOSTICS_BUSY', 'INTERNAL_ERROR'].includes(detail.code)) e.code = detail.code;
      if (typeof detail.message === 'string' && detail.message.length <= 1024 && !/[\x00-\x1F]/.test(detail.message)) e.message = detail.message;
      if (typeof detail.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(detail.requestId)) e.requestId = detail.requestId;
    }
    // Server sends 503 {error:'CHROMIUM_MISSING', message}; also accept {code:'CHROMIUM_MISSING'}.
    if (j.error === 'CHROMIUM_MISSING' || j.code === 'CHROMIUM_MISSING') dispatchEvent(new CustomEvent('pm:chromium-missing'));
    throw e;
  }
  return j;
}
export async function apiBinary(url, opts = {}) {
  const headers = { ...(token && { 'X-UI-Token': token }), ...opts.headers };
  const response = await fetch(url, { method: opts.method || 'GET', headers, body: opts.body });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw Object.assign(new Error(payload.message || payload.error || `HTTP ${response.status}`), { status: response.status, code: payload.code });
  }
  return response.arrayBuffer();
}
// Server events (profile started/stopped/crashed, browser install)
export function subscribe(cb) {
  if (window.pm?.onEvent) return window.pm.onEvent(cb);
  const es = new EventSource('/api/events'); // web mode only; desktop uses the preload bridge (UI token is header-only)
  es.onmessage = m => cb(JSON.parse(m.data));
  return () => es.close();
}
