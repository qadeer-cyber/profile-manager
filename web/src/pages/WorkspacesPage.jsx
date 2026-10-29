import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toasts.jsx';
import { Dialog } from '../components/Dialog.jsx';

export function WorkspacesPage() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [vault, setVault] = useState(null);
  const [dialog, setDialog] = useState(null);
  const load = useCallback(async () => {
    try {
      setItems(await api('/api/workspaces'));
      setVault(await api('/api/workspaces/vault-status'));
    } catch (e) { toast(e.message, 'error'); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  return <>
    <header className="page-head"><div><h1>Workspaces</h1><p className="muted">Local project folders. No cloud sync. Optional vault lock when OS secure storage is available ({vault?.backend || '…'}).</p></div>
      <button className="primary" onClick={() => setDialog({ kind: 'new' })}>New workspace</button></header>
    <div className="table-wrap"><table className="grid"><thead><tr><th>Name</th><th>Profiles</th><th>Vault</th><th></th></tr></thead><tbody>
      {items.map(w => <tr key={w.id}><td>{w.name}{w.notes && <div className="muted small">{w.notes}</div>}</td><td>{w.profileCount}</td>
        <td>{w.vaultLocked ? 'Locked' : '—'}</td>
        <td className="actions"><button className="ghost-danger" onClick={async () => { try { await api(`/api/workspaces/${w.id}`, { method: 'DELETE' }); toast('Deleted', 'success'); load(); } catch (e) { toast(e.message, 'error'); } }}>Delete</button></td></tr>)}
      {!items.length && <tr><td colSpan="4" className="empty">No workspaces yet.</td></tr>}
    </tbody></table></div>
    {dialog?.kind === 'new' && <NewWorkspace vault={vault} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} toast={toast} />}
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
