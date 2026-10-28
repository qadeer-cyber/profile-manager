import React, { useEffect, useState, useCallback, useRef, createContext, useContext } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toasts.jsx';

export function SettingsPage() {
  const toast = useToast();
  const [s, setS] = useState(null), [token, setToken] = useState(''), [show, setShow] = useState(false), [diag, setDiag] = useState(null);
  useEffect(() => { api('/api/settings').then(setS); api('/api/diagnostics').then(setDiag); api('/api/api-token').then(r => setToken(r.token)).catch(() => {}); }, []);
  if (!s) return null;
  const save = async () => { try { setS(await api('/api/settings', { method: 'PUT', body: s })); toast('Settings saved', 'success'); } catch (e) { toast(e.message, 'error'); } };
  return <>
    <header className="page-head"><h1>Settings</h1><button className="primary" onClick={save}>Save changes</button></header>
    <section className="panel"><h2>Browser</h2>
      <label className="check"><input type="checkbox" checked={s.defaultHeadless} onChange={e => setS({ ...s, defaultHeadless: e.target.checked })} /> Launch profiles without a visible window (headless)</label>
      <label>Custom Chromium executable (leave empty to use the bundled/downloaded Chromium)<input value={s.executablePath} onChange={e => setS({ ...s, executablePath: e.target.value })} placeholder="C:\\Path\\to\\chrome.exe" /></label>
      <label>Start page when a profile launches<input value={s.startUrl} onChange={e => setS({ ...s, startUrl: e.target.value })} placeholder="https://…" /></label>
    </section>
    <section className="panel"><h2>Automation API</h2>
      {token ? <><p className="muted">Use this token with <code>/api/v1</code> (header <code>Authorization: Bearer …</code>). Base URL changes each launch in the desktop app; see Diagnostics.</p>
        <div className="row"><input readOnly className="mono-input" value={show ? token : '•'.repeat(24)} /><button onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button><button onClick={() => { navigator.clipboard.writeText(token); toast('Token copied', 'success'); }}>Copy</button></div></>
        : <p className="muted">In web mode the token is in <code>data/api-token</code> or <code>PM_API_TOKEN</code>.</p>}
    </section>
    <section className="panel"><h2>Data</h2>
      <p>Data folder: <code>{diag?.dataDir}</code></p>
      {window.pm?.openDataDir && <button onClick={() => window.pm.openDataDir()}>Open data folder</button>}
      <p className="muted">Proxy passwords: {diag?.encryption.backend}{diag?.encryption.warning && <span className="err-text"> — {diag.encryption.warning}</span>}</p>
    </section>
    <BackupPanel toast={toast} />
  </>;
}

function BackupPanel({ toast }) {
  const [collision, setCollision] = useState('abort');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [encrypt, setEncrypt] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseAgain, setPassphraseAgain] = useState('');
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [listing, setListing] = useState(null);
  const authHeaders = () => ({ ...(window.pm?.uiToken ? { 'X-UI-Token': window.pm.uiToken } : {}) });
  const download = async () => {
    if (encrypt && (passphrase.length < 8 || passphrase !== passphraseAgain)) return toast('Use the same passphrase twice, at least 8 characters', 'error');
    setBusy(true);
    try {
      const response = await fetch('/api/backup', { method: 'POST', headers: { ...authHeaders(), ...(encrypt ? { 'Content-Type': 'application/json' } : {}) }, body: encrypt ? JSON.stringify({ encrypt: true, passphrase }) : undefined });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || `HTTP ${response.status}`); }
      const bytes = await response.arrayBuffer();
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = encrypt ? 'profile-manager-backup.pmbe' : 'profile-manager-backup.pmb'; link.click();
      URL.revokeObjectURL(url);
      setPassphrase(''); setPassphraseAgain('');
      toast(encrypt ? 'Encrypted backup downloaded. It stays on this computer.' : 'Backup downloaded. It contains profile data and proxy passwords.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const inspect = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const response = await fetch('/api/backup/inspect', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...authHeaders(), ...(restorePassphrase ? { 'X-Backup-Passphrase': restorePassphrase } : {}) }, body: await file.arrayBuffer() });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setListing(payload);
      setRestorePassphrase('');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const restore = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const body = await file.arrayBuffer();
      const response = await fetch(`/api/backup/restore?collision=${encodeURIComponent(collision)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...authHeaders(), ...(restorePassphrase ? { 'X-Backup-Passphrase': restorePassphrase } : {}) }, body });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(payload.error || payload.message || `HTTP ${response.status}`), { code: payload.code });
      setResult(payload);
      setRestorePassphrase('');
      toast(`Restored ${payload.added.length + payload.replaced.length + payload.renamed.length} profiles`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return <section className="panel"><h2>Backup and restore</h2>
    <p className="muted">A backup includes profiles, browser data, extension files, and proxy secrets. It does not include the API token and it is not uploaded. Running profiles must be stopped first. An optional encrypted backup uses AES-256-GCM with scrypt (N=16384, r=8, p=1). Older unencrypted backups still restore. Restore checks every path and checksum before it changes this data folder.</p>
    <label className="check"><input type="checkbox" checked={encrypt} onChange={e => setEncrypt(e.target.checked)} /> Encrypt this backup with a passphrase</label>
    {encrypt && <div className="two"><label>Passphrase<input type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} autoComplete="new-password" /></label><label>Repeat passphrase<input type="password" value={passphraseAgain} onChange={e => setPassphraseAgain(e.target.value)} autoComplete="new-password" /></label></div>}
    <div className="row">
      <button className="primary" disabled={busy} onClick={download}>Download backup</button>
      <label>If a profile id already exists<select aria-label="Restore collision" value={collision} onChange={e => setCollision(e.target.value)}><option value="abort">Abort</option><option value="rename">Import as new profiles</option><option value="replace">Replace stopped profiles</option></select></label>
      <label>Restore passphrase<input type="password" value={restorePassphrase} onChange={e => setRestorePassphrase(e.target.value)} autoComplete="current-password" placeholder="Only for an encrypted file" /></label>
      <label className="file-btn">Inspect archive<input type="file" accept=".pmb,.pmbe,application/octet-stream" onChange={inspect} disabled={busy} /></label>
      <label className="file-btn">Restore archive<input type="file" accept=".pmb,.pmbe,application/octet-stream" onChange={restore} disabled={busy} /></label>
    </div>
    {listing && <p className="muted">{listing.encrypted ? 'Encrypted' : 'Unencrypted'} backup{listing.requiresPassphrase && !listing.profiles ? '. A passphrase is required before profile names can be listed.' : ''}{listing.profiles ? `: ${listing.profiles.map(profile => profile.name).join(', ') || 'no profiles'}` : ''}. {listing.containsSecretKey ? 'The file contains a secret key; this list does not show it.' : ''}</p>}
    {result && <p className="muted">Added {result.added.length}, replaced {result.replaced.length}, renamed {result.renamed.length}{result.proxyDetached.length ? `, proxy detached on ${result.proxyDetached.length}` : ''}.</p>}
  </section>;
}

