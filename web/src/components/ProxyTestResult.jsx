import React from 'react';
const MSG = { auth_failed: 'Credentials rejected', connect_refused: 'Connection refused', timeout: 'Timed out', dns: 'Host not found', protocol_unsupported: 'Wrong protocol', unknown: 'Failed' };
export function ProxyTestResult({ r }) {
  if (!r) return null;
  if (r.busy) return <span className="muted">Testing…</span>;
  if (r.ok) return <span className="ok-text" title="Transport check through this proxy configuration. It does not measure every browser API.">Transport ok{r.ip ? ` · egress ${r.ip}` : ' · no address returned'} · {r.latencyMs} ms{r.status ? ` · HTTP ${r.status}` : ''}</span>;
  return <span className="err-text" title={r.message || r.error}>{MSG[r.error] || r.error || (r.status ? 'HTTP ' + r.status : 'Failed')}{r.message ? `: ${r.message}` : ''}</span>;
}
export const proxyErrorLabel = c => MSG[c] || c;
