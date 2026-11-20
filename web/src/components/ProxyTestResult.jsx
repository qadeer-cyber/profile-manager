import React from 'react';
const MSG = { auth_failed: 'Credentials rejected', connect_refused: 'Connection refused', timeout: 'Timed out', dns: 'Host not found', protocol_unsupported: 'Wrong protocol', unknown: 'Failed' };
export function ProxyTestResult({ r }) {
  if (!r) return null;
  if (r.busy) return <span className="muted">Testing…</span>;
  const okLine = r => <span className="ok-text" title="Transport check through this proxy configuration. It does not measure every browser API.">Transport ok{r.ip ? ` · egress ${r.ip}` : ' · no address returned'} · {r.latencyMs} ms{r.status ? ` · HTTP ${r.status}` : ''}</span>;
  if (r.ok) return <span className="proxy-test-ok">{okLine(r)}<NetworkNote n={r.network} /></span>;
  return <span className="err-text" title={r.message || r.error}>{MSG[r.error] || r.error || (r.status ? 'HTTP ' + r.status : 'Failed')}{r.message ? `: ${r.message}` : ''}</span>;
}
export const proxyErrorLabel = c => MSG[c] || c;

// The exit IP's network owner (offline DB-IP ASN Lite). A hosting/cloud owner is named plainly: sites
// often challenge such IPs even in ordinary Chrome. Unknown is not called residential.
export function NetworkNote({ n }) {
  if (!n || n.error || !n.asn) return null;
  return <span className={'network-note' + (n.type === 'hosting' ? ' warn' : '')}>
    {' · '}AS{n.asn} {n.organization || 'unnamed network'}
    {n.type === 'hosting' && <> — a hosting or cloud network. Sites such as Walmart often challenge these IPs, even in ordinary Chrome.</>}
  </span>;
}
