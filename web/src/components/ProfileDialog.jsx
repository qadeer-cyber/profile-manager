import React, { useState } from 'react';
import { api } from '../api.js';
import { useToast } from './Toasts.jsx';
import { Drawer, Tabs } from './Drawer.jsx';
import { ProxyTestResult } from './ProxyTestResult.jsx';
import { useProxyLibrary } from '../hooks/useProxyLibrary.js';

export const emptyForm = { name: '', tags: '', folder: '', notes: '', automationEnabled: false, proxyMode: 'none', proxyId: '', proxy: { type: 'http', host: '', port: '', username: '', password: '' } };

// Profile editor: General / Proxy / Notes tabs. Proxy can be "none", a library entry
// (when the server has the proxy library), or a custom inline proxy (legacy API).
export function ProfileDialog({ initial, folders = [], onSave, onClose }) {
  const [f, setF] = useState(initial);
  const [tab, setTab] = useState('general');
  const [test, setTest] = useState(null);
  const lib = useProxyLibrary();
  const toast = useToast();
  const set = (k, v) => setF({ ...f, [k]: v });
  const setP = (k, v) => { setTest(null); setF({ ...f, proxy: { ...f.proxy, [k]: v } }); };
  const runTest = async () => {
    setTest({ busy: true });
    try {
      const r = f.proxyMode === 'library' ? await api(`/api/proxies/${f.proxyId}/test`, { method: 'POST' })
        : initial.id && f.proxy.password === '••••' ? await api(`/api/profiles/${initial.id}/test-proxy`, { method: 'POST' })
        : await api('/api/proxy/test', { method: 'POST', body: { proxy: f.proxy } });
      setTest(r);
    } catch (e) { setTest({ ok: false, error: e.message }); }
  };
  const submit = () => {
    if (!f.name.trim()) { setTab('general'); return toast('Name is required', 'error'); }
    if (f.proxyMode === 'custom' && (!f.proxy.host || !f.proxy.port)) { setTab('proxy'); return toast('Proxy host and port are required', 'error'); }
    if (f.proxyMode === 'library' && !f.proxyId) { setTab('proxy'); return toast('Pick a proxy from the library', 'error'); }
    onSave(f);
  };
  const tagList = f.tags.split(',').map(t => t.trim()).filter(Boolean);
  return <Drawer title={initial.id ? 'Edit profile' : 'New profile'} subtitle={initial.id ? initial.name : 'Isolated browser profile with its own storage'} onClose={onClose}
    footer={<><button onClick={onClose}>Cancel</button><button className="primary" onClick={submit}>{initial.id ? 'Save changes' : 'Create profile'}</button></>}>
    <Tabs value={tab} onChange={setTab} tabs={[['general', 'General'], ['proxy', 'Proxy'], ['notes', 'Notes']]} />
    {tab === 'general' && <div className="form">
      <label>Name<input autoFocus value={f.name} onChange={e => set('name', e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="e.g. Shop account 1" /></label>
      <label>Folder<input list="pm-folders" value={f.folder} onChange={e => set('folder', e.target.value)} placeholder="No folder" />
        <datalist id="pm-folders">{folders.filter(Boolean).map(x => <option key={x} value={x} />)}</datalist></label>
      <label>Tags<input value={f.tags} onChange={e => set('tags', e.target.value)} placeholder="comma, separated" /></label>
      {tagList.length > 0 && <div className="chips">{tagList.map(t => <span key={t} className="tag">{t}</span>)}</div>}
      <label className="check toggle"><input type="checkbox" role="switch" checked={!!f.automationEnabled} onChange={e => set('automationEnabled', e.target.checked)} /> Enable automation (CDP)</label>
      <p className="muted hint">When on, launching this profile opens a local debugging port that automation tools can connect to. Any program on this computer can then control the browser, so leave it off unless you need it.{initial.running ? ' Applies on the next launch.' : ''}</p>
    </div>}
    {tab === 'proxy' && <div className="form">
      <div className="seg">{[['none', 'Direct connection'], ...(lib.available ? [['library', 'From library']] : []), ['custom', 'Custom']].map(([k, l]) =>
        <button key={k} className={f.proxyMode === k ? 'sel' : ''} onClick={() => { setTest(null); set('proxyMode', k); }}>{l}</button>)}</div>
      {lib.available === false && <p className="muted">The reusable proxy library isn't available on this server yet, so proxies are set per profile.</p>}
      {f.proxyMode === 'library' && <label>Proxy<select value={f.proxyId} onChange={e => { setTest(null); set('proxyId', e.target.value); }}>
        <option value="">Select a proxy…</option>{lib.list.map(p => <option key={p.id} value={p.id}>{p.name} ({p.type}://{p.host}:{p.port}){p.lastTest?.status === 'failed' ? ' · failing' : ''}</option>)}</select></label>}
      {f.proxyMode === 'custom' && <div className="proxy-grid">
        <label>Type<select value={f.proxy.type} onChange={e => setP('type', e.target.value)}><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option></select></label>
        <label>Host<input value={f.proxy.host} onChange={e => setP('host', e.target.value)} placeholder="proxy.example.com" /></label>
        <label>Port<input inputMode="numeric" value={f.proxy.port} onChange={e => setP('port', e.target.value.replace(/\D/g, ''))} placeholder="8080" /></label>
        <label className="span2">Username<input value={f.proxy.username} onChange={e => setP('username', e.target.value)} placeholder="Optional" autoComplete="off" /></label>
        <label>Password<input type="password" value={f.proxy.password} onChange={e => setP('password', e.target.value)} placeholder="Optional" autoComplete="new-password" /></label>
      </div>}
      {f.proxyMode !== 'none' && <div className="row center"><button onClick={runTest} disabled={test?.busy || (f.proxyMode === 'library' ? !f.proxyId : !f.proxy.host || !f.proxy.port)}>Test connection</button><ProxyTestResult r={test} /></div>}
    </div>}
    {tab === 'notes' && <div className="form"><label>Notes<textarea rows="8" value={f.notes} onChange={e => set('notes', e.target.value)} placeholder="Anything worth remembering about this profile" /></label></div>}
  </Drawer>;
}
