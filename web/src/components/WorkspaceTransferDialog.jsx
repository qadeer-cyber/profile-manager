import React, { useState } from 'react';
import { Dialog } from './Dialog.jsx';

export function WorkspaceTransferDialog({ workspace, onClose, onDone }) {
  const [passphrase, setPassphrase] = useState(''), [repeat, setRepeat] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [file, setFile] = useState(null), [preview, setPreview] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const headers = () => ({ ...(window.pm?.uiToken && { 'X-UI-Token': window.pm.uiToken }) });
  async function checked(response) { if (!response.ok) { const body = await response.json().catch(() => ({})); throw Error(body.message || body.error || `HTTP ${response.status}`); } return response; }
  async function run(action) {
    setBusy(true); setError('');
    try {
      if (workspace) {
        // Choose the destination during the user gesture before awaiting server encryption.
        const handle = window.showSaveFilePicker ? await window.showSaveFilePicker({ suggestedName: `workspace-${workspace.id.slice(0, 8)}.pmp` }) : null;
        const response = await checked(await fetch(`/api/workspaces/${workspace.id}/backup/export-stream`, { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ passphrase, confirmSensitive: confirmed }) }));
        if (handle) {
          const writable = await handle.createWritable();
          try { await response.body.pipeTo(writable); } catch (e) { await writable.abort().catch(() => {}); throw e; }
        } else {
          const size = Number(response.headers.get('Content-Length'));
          if (!size || size > 64 * 1024 * 1024) { await response.body.cancel(); throw Error('Use a browser with Save File support for exports larger than 64 MiB.'); }
          const href = URL.createObjectURL(await response.blob()), link = document.createElement('a');
          link.href = href; link.download = `workspace-${workspace.id.slice(0, 8)}.pmp`; link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
        }
        onDone();
      } else {
        const response = await checked(await fetch(`/api/backup/${action}-stream?collision=rename`, { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/octet-stream', 'X-Backup-Passphrase': passphrase }, body: file }));
        const result = await response.json();
        if (action === 'inspect') {
          if (result.format !== 'profile-manager-workspace-backup') throw Error('Choose an encrypted workspace snapshot.');
          setPreview(result);
        } else onDone();
      }
    } catch (e) { if (e.name !== 'AbortError') setError(e.message); }
    finally { setBusy(false); }
  }
  const canExport = passphrase.length >= 8 && passphrase === repeat && confirmed;
  return <Dialog title={workspace ? `Encrypted export: ${workspace.name}` : 'Restore encrypted workspace'} onClose={busy ? () => {} : onClose} footer={<>
    <button disabled={busy} onClick={onClose}>Cancel</button>
    {workspace ? <button disabled={busy || !canExport} onClick={() => run('export')}>Download encrypted workspace</button> : <>
      <button disabled={busy || !file || passphrase.length < 8} onClick={() => run('inspect')}>Inspect workspace</button>
      <button disabled={busy || !preview || !confirmed} onClick={() => run('restore')}>Restore as new workspace</button>
    </>}
  </>}>
    <p>Includes browser profile files, workspace membership, proxy secrets and extension assets. Stop all workspace profiles before export. OS-encrypted browser credentials may not decrypt on another computer.</p>
    {!workspace && <label>Workspace archive<input type="file" accept=".pmp" onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); }} /></label>}
    <label>Passphrase<input type="password" autoComplete="new-password" value={passphrase} onChange={e => { setPassphrase(e.target.value); setPreview(null); }} /></label>
    {workspace && <label>Repeat passphrase<input type="password" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} /></label>}
    <label className="check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{workspace ? 'I understand the export includes sensitive data.' : 'Restore the complete snapshot; preserve existing profiles by remapping conflicts.'}</label>
    {preview && <p role="status">{preview.workspace?.name}: {preview.profiles.length} profiles ready to restore.</p>}
    {error && <p role="alert" className="notice warn">{error}</p>}
  </Dialog>;
}
