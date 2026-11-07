import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toasts.jsx';

export function LicenseAdminPage() {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [list, setList] = useState(null);
  const [form, setForm] = useState({organization: '', password: '', confirm: '', reference: '', name: '', device: '', days: '30', version: '1.0.0'});
  const [token, setToken] = useState('');
  const load = useCallback(async () => {
    const next = await api('/api/admin/status');
    setStatus(next);
    if (next.unlocked) setList(await api('/api/admin/list'));
    else setList(null);
  }, []);
  useEffect(() => { load().catch(error => toast(error.message, 'error')); }, [load, toast]);
  const set = key => event => setForm(current => ({...current, [key]: event.target.value}));
  const run = async (path, body, success) => {
    try { const result = await api(path, {method: 'POST', body}); if (result?.token) setToken(result.token); toast(success, 'success'); await load(); }
    catch (error) { toast(error.message, 'error'); }
  };
  if (!status) return <p className="muted" aria-busy="true">Loading license administration…</p>;
  return <div className="settings-layout" data-shot="license-admin">
    <div>
      <header className="page-head"><h1>License administration</h1></header>
      <p className="muted">Browser profiles stay available while this vault is locked. The signing key remains in the encrypted vault and is not shown here.</p>
      {!status.exists && <section className="panel"><h2>Create organization</h2>
        <label>Organization<input value={form.organization} onChange={set('organization')} /></label>
        <label>Master password (14 characters minimum)<input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" /></label>
        <label>Confirm password<input type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" /></label>
        <button className="primary" onClick={() => run('/api/admin/init', {organization: form.organization, password: form.password, confirm: form.confirm}, 'Organization vault created')}>Create vault</button>
      </section>}
      {status.exists && !status.unlocked && <section className="panel"><h2>Unlock vault</h2>
        <label>Master password<input type="password" value={form.password} onChange={set('password')} autoComplete="current-password" /></label>
        <button className="primary" onClick={() => run('/api/admin/unlock', {password: form.password}, 'Vault unlocked')}>Unlock</button>
        <button onClick={() => run('/api/admin/restore', {password: form.password}, 'Vault restored')}>Restore encrypted backup</button>
      </section>}
      {status.unlocked && list && <section className="panel"><h2>{list.organization}</h2>
        <p className="muted">Public key is stored with the organization. Issued licenses: {list.records.length}.</p>
        <div className="row"><button onClick={() => run('/api/admin/lock', {}, 'Vault locked')}>Lock</button>
          <button onClick={() => run('/api/admin/backup', {}, 'Backup saved')}>Save encrypted backup</button></div>
        <h3 className="h3">Employee</h3>
        <label>Employee reference<input value={form.reference} onChange={set('reference')} /></label>
        <label>Name<input value={form.name} onChange={set('name')} /></label>
        <label>Device code<input value={form.device} onChange={set('device')} spellCheck="false" /></label>
        <button onClick={() => run('/api/admin/employee', {reference: form.reference, name: form.name, device: form.device}, 'Employee saved')}>Save employee</button>
        <label>Validity in days<input value={form.days} onChange={set('days')} inputMode="numeric" /></label>
        <div className="row"><button className="primary" onClick={() => run('/api/admin/issue', {reference: form.reference, days: Number(form.days)}, 'License issued')}>Issue license</button>
          <button onClick={() => { const previous = list.records.find(item => item.label === form.reference && !item.replacedBy); if (!previous) return toast('No active license for that employee', 'error'); run('/api/admin/issue', {reference: form.reference, days: Number(form.days), licenseId: previous.id}, 'License reissued'); }}>Reissue</button></div>
        {token && <label>License token<textarea readOnly value={token} rows="4" spellCheck="false" /></label>}
        <h3 className="h3">Office installer</h3>
        <label>Installer version<input value={form.version} onChange={set('version')} /></label>
        <button onClick={() => run('/api/admin/office-installer', {version: form.version}, 'Office installer created')}>Generate Office installer</button>
        <ul className="muted">{list.records.map(item => <li key={item.id}>{item.label} · {item.device?.slice(0, 12)}… · {item.replacedBy ? 'replaced' : 'active'} · {item.expiresAt ? new Date(item.expiresAt).toLocaleDateString() : ''}</li>)}</ul>
      </section>}
    </div>
  </div>;
}
