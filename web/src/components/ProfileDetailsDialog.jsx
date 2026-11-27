import React from 'react';
import { Dialog } from './Dialog.jsx';
import { ProfileHealth } from './ProfileHealth.jsx';
import { crashSummary } from '../lib.js';
import { engineLabel, proxyLabel, proxyEvidenceFields, nativeVerification, tabRestoreBadge } from '../lib/profileRow.js';

// Everything the old multi-line row showed inline, laid out for reading instead of squeezed into the table.
export function ProfileDetailsDialog({ profile: p, status, onClose, onEdit }) {
  const proxy = proxyLabel(p.proxy);
  const tabs = tabRestoreBadge(p.tabRestore, p.running);
  const native = nativeVerification(p);
  const Row = ({ k, children }) => <div className="overview-row"><span>{k}</span><strong>{children}</strong></div>;
  return <Dialog wide title={`Details · ${p.name}`} onClose={onClose} footer={<><button onClick={onClose}>Close</button><button className="primary" onClick={onEdit}>Edit profile</button></>}>
    <ProfileHealth profile={p} />
    <section className="details-grid">
      <div>
        <h4>Profile</h4>
        <Row k="Name">{p.name}{p.isQuick ? ' (quick profile)' : ''}</Row>
        <Row k="Status">{status.label}</Row>
        {status.showError && <Row k="Last error"><span className="err-text">{crashSummary(p.last_error)}</span><br /><span className="mono-sm muted">{p.last_error}</span></Row>}
        <Row k="Engine">{engineLabel(p).full}</Row>
        <Row k="Storage">Local data folder</Row>
        <Row k="Folder">{p.folder || 'None'}</Row>
        <Row k="Tags">{p.tags.length ? p.tags.join(', ') : 'None'}</Row>
        <Row k="Notes"><span className="pre">{p.notes || 'None'}</span></Row>
        <Row k="Last used">{p.last_launched_at ? new Date(p.last_launched_at).toLocaleString() : 'Never'}</Row>
        <Row k="Automation">{p.automationEnabled ? 'Enabled' : 'Disabled'}</Row>
        {p.cdp && <Row k="Automation endpoint"><span className="mono-sm">{p.cdp.wsEndpoint || p.cdp.debuggerAddress}</span></Row>}
        {tabs && <Row k="Tab restore">{tabs.title}</Row>}
      </div>
      <div>
        <h4>Network</h4>
        <Row k="Proxy">{proxy.direct ? 'Direct connection' : <>{proxy.text}<br /><span className="mono-sm muted">{proxy.title}</span>{proxy.authenticated ? ' · credentials stored' : ''}</>}</Row>
        {proxyEvidenceFields(p.lastProxyLocation).map(([k, v]) => <Row key={k} k={k}>{v}</Row>)}
        {!p.lastProxyLocation && !proxy.direct && <p className="muted small">No stored proxy-exit evidence for the current proxy revision.</p>}
        {native.length > 0 && <><h4>Native runtime verification</h4>{native.map(([k, v]) => <Row key={k} k={k}>{v}</Row>)}</>}
      </div>
    </section>
  </Dialog>;
}
