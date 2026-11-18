import React, { useState } from 'react';
import { api } from '../api.js';
import { Dialog } from './Dialog.jsx';
export function WorkspaceSyncDialog({ workspace, onClose, onDone }) {
  const [serverUrl, setServerUrl] = useState(''), [remoteId, setRemoteId] = useState(workspace?.id || '');
  const [token, setToken] = useState(''), [passphrase, setPassphrase] = useState(''), [revision, setRevision] = useState('0');
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  async function transfer(push) {
    setBusy(true); setStatus('');
    try {
      const result = await api(push ? `/api/workspaces/${workspace.id}/sync/push` : '/api/workspaces/sync/pull', { method: 'POST', body: { serverUrl, remoteId, token, passphrase, expectedRevision: Number(revision), confirmSensitive: confirmed } });
      setRevision(String(result.revision)); setConfirmed(false);
      setStatus(push ? `Encrypted revision ${result.revision} published to the relay.` : `Revision ${result.revision} restored into a separate local workspace. Existing profiles were retained.`);
      onDone();
    } catch (e) { setStatus(e.message); } finally { setBusy(false); }
  }
  return <Dialog title="Encrypted workspace synchronization" onClose={onClose} footer={<><button disabled={busy} onClick={onClose}>Close</button><button disabled={busy || !confirmed} onClick={() => transfer(false)}>Pull as new workspace</button>{workspace && <button disabled={busy || !confirmed} onClick={() => transfer(true)}>Push encrypted snapshot</button>}</>}>
    <p>Use a configured self-hosted HTTPS relay with a device token authorized for this workspace. The passphrase stays on this computer. Tokens and passphrases are held only in this dialog. Concurrent changes require explicit conflict resolution.</p>
    <label>HTTPS relay origin<input type="url" value={serverUrl} onChange={e => setServerUrl(e.target.value)} placeholder="https://relay.example.com:7443" /></label>
    <label>Remote workspace UUID<input value={remoteId} onChange={e => setRemoteId(e.target.value)} /></label>
    <label>Device access token<input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></label>
    <label>Encryption passphrase<input type="password" autoComplete="off" value={passphrase} onChange={e => setPassphrase(e.target.value)} /></label>
    <label>Expected remote revision<input type="number" min="0" step="1" value={revision} onChange={e => setRevision(e.target.value)} /></label>
    <label className="check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I authorize this encrypted transfer. All workspace profiles are stopped before pushing.</label>
    {status && <p role="status">{status}</p>}
  </Dialog>;
}
