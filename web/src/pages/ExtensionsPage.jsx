import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toasts.jsx';
import { Confirm, Dialog } from '../components/Dialog.jsx';
import { Icon } from '../components/Icon.jsx';
import { plural } from '../lib.js';

export function ExtensionsPage() {
  const toast = useToast();
  const [list, setList] = useState([]), [loaded, setLoaded] = useState(false), [dialog, setDialog] = useState(null);
  const load = () => api('/api/extensions').then(setList).catch(e => toast(e.message, 'error')).finally(() => setLoaded(true));
  useEffect(() => { load(); }, []);
  const remove = async (ext, force) => {
    try { await api(`/api/extensions/${ext.id}${force ? '?force=1' : ''}`, { method: 'DELETE' }); toast(`Removed ${ext.name}`, 'success'); load(); }
    catch (e) { if (/assigned/i.test(e.message) && !force) setDialog({ kind: 'force', data: ext, msg: e.message }); else toast(e.message, 'error'); }
  };
  return <>
    <header className="page-head"><div><h1>Extensions</h1><div className="muted">{plural(list.length, 'unpacked extension')} in the library</div></div>
      <button className="primary" onClick={() => setDialog({ kind: 'import' })}><Icon name="upload" /> Import Chromium</button>
      <button onClick={() => setDialog({ kind: 'importGecko' })}>Import Firefox (gecko)</button></header>
    <div className="notice warn">Import copies a local unpacked extension after checking its manifest. The library shows the version and the permissions the manifest declares. Assigning an extension to a profile does not make it private, and removing it here deletes the copied files.</div>
    <div className="table-wrap"><table className="grid"><thead><tr>
      <th>Name</th><th>Version</th><th>Permissions</th><th>Profiles</th><th></th>
    </tr></thead><tbody>
      {list.map(ext => <tr key={ext.id}>
        <td className="name">{ext.name}{ext.description ? <div className="muted">{ext.description}</div> : null}</td>
        <td className="mono-sm">{ext.version} <span className="muted">MV{ext.manifestVersion}</span></td>
        <td className="small">{permissionText(ext)}</td>
        <td>{ext.assignedProfiles || <span className="muted">0</span>}</td>
        <td className="actions">
          <button onClick={() => setDialog({ kind: 'assign', data: ext })}>Assign</button>
          <button className="icon-btn danger" aria-label={'Remove ' + ext.name} title="Remove" onClick={() => remove(ext, false)}><Icon name="trash" /></button>
        </td>
      </tr>)}
      {loaded && !list.length && <tr><td colSpan="5" className="empty">No extensions yet. Import a folder that contains a manifest.json.</td></tr>}
    </tbody></table></div>
    {dialog?.kind === 'import' && <ImportDialog onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
    {dialog?.kind === 'importGecko' && <ImportGeckoDialog onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
    {dialog?.kind === 'assign' && <AssignDialog extension={dialog.data} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); load(); }} />}
    {dialog?.kind === 'force' && <Confirm title="Extension is assigned" danger confirmLabel="Unassign and remove" message={`${dialog.msg} Removing it also drops those assignments. The copied files are deleted.`} onConfirm={() => remove(dialog.data, true)} onClose={() => setDialog(null)} />}
  </>;
}

function permissionText(ext) {
  const declared = [...ext.permissions, ...ext.hostPermissions];
  const optional = [...(ext.optionalPermissions || []), ...(ext.optionalHostPermissions || [])];
  if (!declared.length && !optional.length) return <span className="muted">None declared</span>;
  return <>{declared.join(', ') || 'None declared'}{optional.length ? <div className="muted">Optional: {optional.join(', ')}</div> : null}</>;
}

function ImportGeckoDialog({ onClose, onDone }) {
  const toast = useToast();
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!source.trim()) return toast('Enter the absolute path of the unpacked gecko extension', 'error');
    setBusy(true);
    try {
      const r = await api('/api/gecko-extensions/import', { method: 'POST', body: { path: source.trim() } });
      toast(`Imported Firefox extension ${r.name}`, 'success');
      onDone();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return <Dialog title="Import Firefox extension" onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={submit}>Import</button></>}>
    <p className="muted">Unpacked folder or signed <code>.xpi</code> path. Manifest must include browser_specific_settings.gecko.id. Mozilla signature is required for XPI; signing is not bypassed.</p>
    <label>Extension path<input autoFocus value={source} onChange={e => setSource(e.target.value)} placeholder="Absolute path to folder or .xpi" /></label>
  </Dialog>;
}

function ImportDialog({ onClose, onDone }) {
  const toast = useToast();
  const [source, setSource] = useState(''), [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!source.trim()) return toast('Enter the absolute path of the unpacked extension', 'error');
    setBusy(true);
    try {
      const ext = await api('/api/extensions/import', { method: 'POST', body: { path: source.trim() } });
      toast(`Imported ${ext.name} ${ext.version}`, 'success');
      onDone();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return <Dialog title="Import unpacked extension" onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={submit}>Import</button></>}>
    <p className="muted">Point at a folder on this computer that contains manifest.json. The folder is copied into the app's data directory. Remote packages and symlinks are rejected. Manifest version 2 or 3 is required.</p>
    <label>Extension folder<input autoFocus value={source} onChange={e => setSource(e.target.value)} placeholder="Absolute path to the unpacked extension" onKeyDown={e => e.key === 'Enter' && submit()} /></label>
  </Dialog>;
}

function AssignDialog({ extension, onClose, onSaved }) {
  const toast = useToast();
  const [profiles, setProfiles] = useState(null);
  const [chosen, setChosen] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/api/profiles').then(list => {
      setProfiles(list);
      setChosen(Object.fromEntries(list.map(p => {
        const hit = (p.extensions || []).find(item => item.id === extension.id);
        return [p.id, { assigned: !!hit, enabled: hit ? !!hit.enabled : true }];
      })));
    }).catch(e => toast(e.message, 'error'));
  }, [extension.id, toast]);
  const save = async () => {
    setBusy(true);
    try {
      for (const profile of profiles || []) {
        const want = chosen[profile.id];
        const had = (profile.extensions || []).find(item => item.id === extension.id);
        if (want?.assigned && !had) await api(`/api/profiles/${profile.id}/extensions`, { method: 'POST', body: { extensionId: extension.id, enabled: !!want.enabled } });
        else if (want?.assigned && had && !!had.enabled !== !!want.enabled) await api(`/api/profiles/${profile.id}/extensions/${extension.id}`, { method: 'PATCH', body: { enabled: !!want.enabled } });
        else if (want && !want.assigned && had) await api(`/api/profiles/${profile.id}/extensions/${extension.id}`, { method: 'DELETE' });
      }
      toast(`Assignments saved for ${extension.name}`, 'success');
      onSaved();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return <Dialog title={`Assign ${extension.name}`} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !profiles} onClick={save}>Save assignments</button></>}>
    <p className="muted">{extension.version} · {permissionText(extension)}</p>
    <p className="muted">One extension can be assigned to several profiles. Each profile loads only its own enabled extensions. A running profile keeps the previous set until the next launch. Headless Chromium often does not load unpacked extensions.</p>
    {profiles && !profiles.length && <p className="muted">Create a profile first.</p>}
    {(profiles || []).map(profile => {
      const row = chosen[profile.id] || { assigned: false, enabled: true };
      return <div key={profile.id} className="ext-row">
        <label className="check"><input type="checkbox" checked={row.assigned} onChange={e => setChosen({ ...chosen, [profile.id]: { ...row, assigned: e.target.checked } })} /> {profile.name}</label>
        {row.assigned && <label className="check"><input type="checkbox" checked={row.enabled} onChange={e => setChosen({ ...chosen, [profile.id]: { ...row, enabled: e.target.checked } })} /> Enabled</label>}
      </div>;
    })}
  </Dialog>;
}
