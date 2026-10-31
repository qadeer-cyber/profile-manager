import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toasts.jsx';
import { Confirm, Dialog } from '../components/Dialog.jsx';
import { Icon } from '../components/Icon.jsx';
import { plural } from '../lib.js';

export function ExtensionsPage() {
  const toast = useToast();
  const [list, setList] = useState([]), [gecko, setGecko] = useState({ items: [], report: null });
  const [loaded, setLoaded] = useState(false), [geckoLoaded, setGeckoLoaded] = useState(false), [dialog, setDialog] = useState(null);
  const load = () => {
    api('/api/extensions').then(setList).catch(e => toast(e.message, 'error')).finally(() => setLoaded(true));
    api('/api/gecko-extensions').then(setGecko).catch(e => toast(e.message, 'error')).finally(() => setGeckoLoaded(true));
  };
  useEffect(() => { load(); }, []);
  const remove = async (ext, force) => {
    try { await api(`/api/extensions/${ext.id}${force ? '?force=1' : ''}`, { method: 'DELETE' }); toast(`Removed ${ext.name}`, 'success'); load(); }
    catch (e) { if (/assigned/i.test(e.message) && !force) setDialog({ kind: 'force', data: ext, msg: e.message }); else toast(e.message, 'error'); }
  };
  return <>
    <header className="page-head"><div><h1>Extensions</h1><div className="muted">{plural(list.length, 'extension')} in the library</div></div>
      <button className="primary" onClick={() => setDialog({ kind: 'import' })}><Icon name="upload" /> Import Chromium</button>
      <button onClick={() => setDialog({ kind: 'importGecko' })}>Import Firefox (gecko)</button></header>
    <div className="notice warn">Import copies a local unpacked extension after checking its manifest. The library shows the version and the permissions the manifest declares. Assigning an extension to a profile does not make it private, and removing it here deletes the copied files.</div>
    <div className="table-wrap"><table className="grid"><thead><tr>
      <th>Name</th><th>Version</th><th>Permissions</th><th>Profiles</th><th></th>
    </tr></thead><tbody>
      {list.map(ext => <tr key={ext.id}>
        <td className="name">{ext.name} <span className="muted">{ext.browserEngine === 'firefox' ? 'Firefox · signed installation' : 'Chromium'}</span>{ext.description ? <div className="muted">{ext.description}</div> : null}</td>
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
    <section className="panel"><h2>Firefox / Gecko library</h2>
      <p className="muted small">{gecko.report?.signingPolicy || 'Mozilla signed extensions only; no signing bypass.'}</p>
      <div className="table-wrap"><table className="grid"><thead><tr><th>Name</th><th>Gecko ID</th><th>Version</th><th>Profiles</th><th></th></tr></thead><tbody>
        {gecko.items.map(ext => <tr key={ext.id}><td className="name">{ext.name}</td><td className="mono-sm">{ext.geckoExtensionId || '—'}</td><td>{ext.version}</td><td>{ext.assignedProfiles || 0}</td><td><button onClick={() => setDialog({ kind: 'manageGecko', data: ext })}>Manage in profile</button></td></tr>)}
        {geckoLoaded && !gecko.items.length && <tr><td colSpan="4" className="empty">No Firefox extensions yet. Import an unpacked folder or signed .xpi.</td></tr>}
        {!geckoLoaded && <tr><td colSpan="4" className="empty">Loading Gecko extensions…</td></tr>}
      </tbody></table></div></section>
    {dialog?.kind === 'manageGecko' && <ManageGeckoDialog extension={dialog.data} onClose={() => setDialog(null)} />}
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
    if (!source.trim()) return toast('Enter the absolute path of a Firefox extension folder or XPI', 'error');
    setBusy(true);
    try {
      const r = await api('/api/gecko-extensions/import', { method: 'POST', body: { path: source.trim() } });
      toast(`Imported Firefox extension ${r.name}`, 'success');
      onDone();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return <Dialog title="Import Firefox extension" onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={submit}>Import</button></>}>
    <p className="muted">Import an unpacked development folder or a <code>.xpi</code> into the local library. Import checks archive safety, not Mozilla signatures. Firefox verifies signing and compatibility during installation.</p><p className="notice warn">Use Manage in profile to permanently install a signed XPI into a running Firefox profile with automation enabled. Firefox performs cryptographic signature, certificate trust and compatibility checks. Enable/disable remains available in about:addons. Unpacked development folders are library inventory only.</p>
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
      list = list.filter(p => (p.browserEngine || 'chromium') === (extension.browserEngine || 'chromium'));
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
    <p className="muted">{extension.browserEngine === 'firefox' ? 'Firefox assignments record inventory only; they do not install or toggle add-ons. Install and manage each add-on in that profile using about:addons.' : 'One extension can be assigned to several profiles. Each profile loads only its own enabled extensions after relaunch. Headless Chromium may not load unpacked extensions.'}</p>
    {profiles && !profiles.length && <p className="muted">Create a profile first.</p>}
    {(profiles || []).map(profile => {
      const row = chosen[profile.id] || { assigned: false, enabled: true };
      return <div key={profile.id} className="ext-row">
        <label className="check"><input type="checkbox" checked={row.assigned} onChange={e => setChosen({ ...chosen, [profile.id]: { ...row, assigned: e.target.checked } })} /> {profile.name}</label>
        {row.assigned && <label className="check"><input type="checkbox" checked={row.enabled} onChange={e => setChosen({ ...chosen, [profile.id]: { ...row, enabled: e.target.checked } })} /> {extension.browserEngine === 'firefox' ? 'Included in inventory' : 'Enabled'}</label>}
      </div>;
    })}
  </Dialog>;
}

function ManageGeckoDialog({ extension, onClose }) {
  const [profiles, setProfiles] = useState([]), [selected, setSelected] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [addons, setAddons] = useState([]);
  useEffect(() => { api('/api/profiles').then(rows => setProfiles(rows.filter(p => p.browserEngine === 'firefox'))).catch(e => setStatus(e.message)); }, []);
  async function inspect(id) { if (id) setAddons((await api(`/api/profiles/${id}/gecko-extensions`)).addons); }
  async function act(action) {
    setBusy(true); setStatus('');
    try {
      const result = await api(`/api/profiles/${selected}/gecko-extensions/${extension.id}/${action}`, { method: 'POST', body: { confirm: confirmed } });
      setStatus(result.removed ? 'Removal verified in Firefox profile data.' : 'Permanent installation and signed package verified by Firefox. Restart persistence must be checked after reopening.');
      await inspect(selected); setConfirmed(false);
    } catch (e) { setStatus(e.message); } finally { setBusy(false); }
  }
  return <Dialog title={`Manage ${extension.name} in Firefox`} onClose={onClose} footer={<>
    <button onClick={onClose}>Close</button><button disabled={busy || !selected || !confirmed} onClick={() => act('install')}>Install signed XPI</button>
    <button disabled={busy || !selected || !confirmed} onClick={() => act('remove')}>Remove from profile</button>
  </>}>
    <p>Launch the target Firefox profile with automation enabled. Other automation clients must disconnect before this operation. Firefox verifies Mozilla signing and compatibility; unsigned or unpacked packages cannot be permanently installed here.</p>
    <label>Firefox profile<select value={selected} onChange={e => { setSelected(e.target.value); setConfirmed(false); inspect(e.target.value).catch(e => setStatus(e.message)); }}><option value="">Choose profile</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}{p.running ? ' (running)' : ' (stopped)'}</option>)}</select></label>
    <label className="check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I confirm this change to the selected profile.</label>
    {addons.filter(a => a.id === extension.geckoExtensionId).map(a => <p key={a.id}>Recorded version {a.version}; {a.signatureVerified ? 'Firefox signature accepted' : 'signature unverified'}; {a.active ? 'active' : 'inactive'}. Enable/disable in about:addons.</p>)}
    {status && <p role="status">{status}</p>}
  </Dialog>;

}
