import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toasts.jsx';
import { Dialog } from '../components/Dialog.jsx';

export function WorkspacesPage({ onOpenProfiles }) {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [vault, setVault] = useState(null);
  const [dialog, setDialog] = useState(null);
  const load = useCallback(async () => {
    try {
      const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
      setItems(await api(`/api/workspaces${qs}`));
      setVault(await api('/api/workspaces/vault-status'));
    } catch (e) { toast(e.message, 'error'); }
  }, [toast, q]);
  useEffect(() => { load(); }, [load]);
  return <>
    <header className="page-head"><div><h1>Workspaces</h1><p className="muted">Local project folders. No cloud sync. Optional vault lock when OS secure storage is available ({vault?.backend || '…'}).</p></div>
      <div className="row">
        <label className="file-btn">Import JSON<input type="file" accept="application/json,.json" onChange={async e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            const payload = JSON.parse(await file.text());
            await api('/api/workspaces/import', { method: 'POST', body: payload });
            toast('Workspace import applied (existing profiles re-linked by id)', 'success');
            load();
          } catch (err) { toast(err.message, 'error'); }
        }} /></label>
        <button className="primary" onClick={() => setDialog({ kind: 'new' })}>New workspace</button></div></header>
    <div className="toolbar"><input type="search" placeholder="Search name or notes…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search workspaces" /></div>
    <div className="table-wrap"><table className="grid"><thead><tr><th>Name</th><th>Profiles</th><th>Vault</th><th></th></tr></thead><tbody>
      {items.map(w => <tr key={w.id}><td>{w.name}{w.notes && <div className="muted small">{w.notes}</div>}</td><td>{w.profileCount}</td>
        <td>{w.vaultLocked ? 'Locked' : '—'}</td>
        <td className="actions">
          {w.profileCount > 0 && onOpenProfiles && <button onClick={() => onOpenProfiles(w.id)}>View profiles</button>}
          <button onClick={async () => {
            try {
              const bundle = await api(`/api/workspaces/${w.id}/export`);
              const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `workspace-${w.name.replace(/[^\w.-]+/g, '_')}.json`;
              a.click();
              URL.revokeObjectURL(a.href);
              toast('Workspace export downloaded', 'success');
            } catch (e) { toast(e.message, 'error'); }
          }}>Export</button>
          <button onClick={() => setDialog({ kind: 'edit', data: w })}>Edit</button>
          <button className="ghost-danger" onClick={async () => { try { await api(`/api/workspaces/${w.id}`, { method: 'DELETE' }); toast('Deleted', 'success'); load(); } catch (e) { toast(e.message, 'error'); } }}>Delete</button></td></tr>)}
      {!items.length && <tr><td colSpan="4" className="empty">No workspaces yet.</td></tr>}
    </tbody></table></div>
    {dialog?.kind === 'new' && <NewWorkspace vault={vault} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} toast={toast} />}
    {dialog?.kind === 'edit' && <EditWorkspace vault={vault} workspace={dialog.data} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} toast={toast} />}
  </>;
}

function NewWorkspace({ vault, onClose, onDone, toast }) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [vaultLocked, setVaultLocked] = useState(false);
  return <Dialog title="New workspace" onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={!name.trim()} onClick={async () => {
    try {
      await api('/api/workspaces', { method: 'POST', body: { name: name.trim(), notes, vaultLocked: vaultLocked && vault?.vaultStorageAvailable } });
      toast('Workspace created', 'success'); onDone();
    } catch (e) { toast(e.message, 'error'); }
  }}>Create</button></>}>
    <label>Name<input autoFocus value={name} onChange={e => setName(e.target.value)} /></label>
    <label>Notes<textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></label>
    <label className="check"><input type="checkbox" disabled={!vault?.vaultStorageAvailable} checked={vaultLocked} onChange={e => setVaultLocked(e.target.checked)} /> Vault lock (requires desktop secure storage)</label>
    {!vault?.vaultStorageAvailable && <p className="muted small">Vault lock is unavailable in web-only mode without OS secure storage.</p>}
  </Dialog>;
}

function EditWorkspace({ vault, workspace, onClose, onDone, toast }) {
  const [name, setName] = useState(workspace.name);
  const [notes, setNotes] = useState(workspace.notes || '');
  const [vaultLocked, setVaultLocked] = useState(!!workspace.vaultLocked);
  return <Dialog title="Edit workspace" onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={!name.trim()} onClick={async () => {
    try {
      await api(`/api/workspaces/${workspace.id}`, { method: 'PATCH', body: { name: name.trim(), notes, vaultLocked: vaultLocked && vault?.vaultStorageAvailable } });
      toast('Workspace updated', 'success'); onDone();
    } catch (e) { toast(e.message, 'error'); }
  }}>Save</button></>}>
    <label>Name<input autoFocus value={name} onChange={e => setName(e.target.value)} /></label>
    <label>Notes<textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></label>
    <label className="check"><input type="checkbox" disabled={!vault?.vaultStorageAvailable} checked={vaultLocked} onChange={e => setVaultLocked(e.target.checked)} /> Vault lock</label>
  </Dialog>;
}
