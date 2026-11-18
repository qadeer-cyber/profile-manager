import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toasts.jsx';
import { Confirm, Dialog } from '../components/Dialog.jsx';
import { plural } from '../lib.js';

export function TemplatesPage({ reloadMeta }) {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(null);
  const [remove, setRemove] = useState(null);
  const load = useCallback(async () => {
    try { setItems(await api('/api/templates')); setLoaded(true); } catch (e) { toast(e.message, 'error'); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  return <>
    <header className="page-head">
      <div><h1>Templates</h1><div className="muted">Reusable profile presets (engine, proxy, fingerprint settings). Extensions are not copied.</div></div>
      <button className="primary" onClick={() => setCreateOpen(true)}>Create from profile</button>
    </header>
    <div className="table-wrap"><table className="grid"><thead><tr><th>Name</th><th>Updated</th><th></th></tr></thead><tbody>
      {items.map(t => <tr key={t.id}><td>{t.name}</td><td className="muted">{t.updated_at ? new Date(t.updated_at).toLocaleString() : ''}</td>
        <td className="actions">
          <button onClick={async () => {
            try {
              await api(`/api/profiles/from-template/${t.id}`, { method: 'POST', body: {} });
              toast('Profile created from template', 'success');
              reloadMeta?.();
            } catch (e) { toast(e.message, 'error'); }
          }}>Create profile</button>
          <button onClick={() => setBulkOpen(t)}>Bulk create…</button>
          <button className="ghost-danger" onClick={() => setRemove(t)}>Delete</button>
        </td></tr>)}
      {loaded && !items.length && <tr><td colSpan="3" className="empty">No templates yet. Save a template from a profile on the Profiles page or create one here.</td></tr>}
    </tbody></table></div>
    {createOpen && <CreateTemplateDialog onClose={() => setCreateOpen(false)} onDone={() => { setCreateOpen(false); load(); }} toast={toast} />}
    {bulkOpen && <BulkFromTemplateDialog template={bulkOpen} onClose={() => setBulkOpen(null)} onDone={() => { setBulkOpen(null); reloadMeta?.(); }} toast={toast} />}
    {remove && <Confirm title="Delete template" danger confirmLabel="Delete"
      message={`Remove template “${remove.name}”? Existing profiles are not affected.`}
      onConfirm={async () => {
        try { await api(`/api/templates/${remove.id}`, { method: 'DELETE' }); toast('Template deleted', 'success'); setRemove(null); load(); }
        catch (e) { toast(e.message, 'error'); }
      }} onClose={() => setRemove(null)} />}
  </>;
}

function CreateTemplateDialog({ onClose, onDone, toast }) {
  const [profiles, setProfiles] = useState([]);
  const [profileId, setProfileId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/api/profile-table?' + new URLSearchParams({ page: '1', pageSize: '100', sort: 'updated_at', dir: 'desc' }))
      .then(data => setProfiles(data.items || []))
      .catch(() => {});
  }, []);
  const submit = async () => {
    if (!profileId) return;
    setBusy(true);
    try {
      await api('/api/templates', { method: 'POST', body: { profileId, name: name.trim() || undefined } });
      toast('Template saved', 'success');
      onDone();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return <Dialog title="Create template from profile" onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !profileId} onClick={submit}>Save template</button></>}>
    <label>Source profile<select value={profileId} onChange={e => setProfileId(e.target.value)}><option value="">Select a profile…</option>
      {profiles.map(p => <option key={p.id} value={p.id}>{p.name}{p.folder ? ` · ${p.folder}` : ''}</option>)}</select></label>
    <label>Template name (optional)<input value={name} onChange={e => setName(e.target.value)} placeholder="Defaults to “{profile name} template”" /></label>
  </Dialog>;
}

function BulkFromTemplateDialog({ template, onClose, onDone, toast }) {
  const [count, setCount] = useState(5);
  const [prefix, setPrefix] = useState(template.name);
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      let state = await api('/api/bulk/jobs', { method: 'POST', body: { action: 'fromTemplate', templateId: template.id, count: Number(count), namePrefix: prefix.trim() || template.name, folder } });
      while (state.status === 'running' || state.status === 'queued') {
        await new Promise(r => setTimeout(r, 150));
        state = await api(`/api/bulk/jobs/${state.id}`);
      }
      const failed = (state.items || []).filter(i => i.ok === false);
      if (failed.length) toast(`Created ${state.total - failed.length} of ${state.total} profiles`, 'error');
      else toast(`Created ${plural(state.total, 'profile')}`, 'success');
      onDone();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return <Dialog title={`Bulk create from “${template.name}”`} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={submit}>Create</button></>}>
    <label>Number of profiles<input type="number" min={1} max={50} value={count} onChange={e => setCount(e.target.value)} /></label>
    <label>Name prefix<input value={prefix} onChange={e => setPrefix(e.target.value)} /></label>
    <label>Folder (optional)<input value={folder} onChange={e => setFolder(e.target.value)} placeholder="Leave empty to use template folder" /></label>
    <p className="muted">Profiles are named “{prefix || template.name} 1”, “{prefix || template.name} 2”, … up to 50.</p>
  </Dialog>;
}
