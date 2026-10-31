import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toasts.jsx';
import { Confirm, Dialog } from '../components/Dialog.jsx';

export function TrashPage() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [purge, setPurge] = useState(null);
  const load = useCallback(async () => {
    try { setItems(await api('/api/trash')); setLoaded(true); } catch (e) { toast(e.message, 'error'); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  return <>
    <header className="page-head"><h1>Trash</h1><button onClick={load}>Refresh</button></header>
    <section className="panel"><p className="muted">Deleted profiles stay here until you restore them or permanently remove them. Permanent delete requires typing the profile name.</p></section>
    <div className="table-wrap"><table className="grid"><thead><tr><th>Name</th><th>Deleted</th><th></th></tr></thead><tbody>
      {items.map(p => <tr key={p.id}><td>{p.name}{p.purgeError && <div className="notice warn">Purge interrupted. Files may be incomplete. Restore a backup in Settings or explicitly retry permanent deletion.</div>}</td><td className="muted">{p.deletedAt ? new Date(p.deletedAt).toLocaleString() : ''}</td>
        <td className="actions"><button disabled={!!p.purgeError} title={p.purgeError ? 'Restore a backup to recover this profile' : undefined} onClick={async () => { try { await api(`/api/trash/${p.id}/restore`, { method: 'POST' }); toast('Restored', 'success'); load(); } catch (e) { toast(e.message, 'error'); } }}>Restore</button>
          <button className="ghost-danger" onClick={() => setPurge(p)}>Delete forever</button></td></tr>)}
      {loaded && !items.length && <tr><td colSpan="3" className="empty">Trash is empty.</td></tr>}
    </tbody></table></div>
    {purge && !purge.step && <Confirm title="Permanently delete" danger confirmLabel="Delete forever"
      message={`Type the profile name “${purge.name}” in the next dialog to confirm.`}
      onConfirm={() => setPurge({ ...purge, step: 2 })} onClose={() => setPurge(null)} />}
    {purge?.step === 2 && <PurgeDialog profile={purge} onClose={() => setPurge(null)} onDone={() => { setPurge(null); load(); }} toast={toast} />}
  </>;
}

function PurgeDialog({ profile, onClose, onDone, toast }) {
  const [name, setName] = useState('');
  return <Dialog title="Confirm permanent delete" onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="danger" disabled={name !== profile.name} onClick={async () => {
    try { await api(`/api/trash/${profile.id}?confirmName=${encodeURIComponent(name)}`, { method: 'DELETE' }); toast('Permanently deleted', 'success'); onDone(); }
    catch (e) { toast(e.message, 'error'); }
  }}>Delete forever</button></>}>
    <p>This removes all browser data for <strong>{profile.name}</strong>.</p>
    <label>Type the profile name to confirm<input value={name} onChange={e => setName(e.target.value)} autoFocus /></label>
  </Dialog>;
}
