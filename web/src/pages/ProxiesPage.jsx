import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toasts.jsx';
import { Dialog, Confirm } from '../components/Dialog.jsx';
import { Icon } from '../components/Icon.jsx';
import { ProxyTestResult, proxyErrorLabel } from '../components/ProxyTestResult.jsx';
import { useProxyLibrary } from '../hooks/useProxyLibrary.js';
import { useSelection } from '../hooks/useSelection.js';
import { ProviderPanel } from '../components/ProviderPanel.jsx';
import { runAll, plural } from '../lib.js';

// Proxy library manager (docs/proxy-api.md). Falls back to a read-only summary of
// per-profile proxies when the server doesn't provide /api/proxies yet.
export function ProxiesPage() {
  const toast = useToast();
  const [q, setQ] = useState(''), [status, setStatus] = useState(''), [tag, setTag] = useState('');
  const lib = useProxyLibrary({ q, status, tag });
  const [dialog, setDialog] = useState(null), [testing, setTesting] = useState({});
  const S = useSelection(lib.list.map(p => p.id));
  const tags = useMemo(() => [...new Set(lib.list.flatMap(p => p.tags))].sort(), [lib.list]);
  if (lib.available === false) return <LegacySummary />;

  const test = async ids => {
    setTesting(t => ({ ...t, ...Object.fromEntries(ids.map(i => [i, true])) }));
    const r = await runAll(ids, id => api(`/api/proxies/${id}/test`, { method: 'POST' }), 4);
    setTesting(t => ({ ...t, ...Object.fromEntries(ids.map(i => [i, false])) })); lib.reload();
    if (ids.length > 1) toast(`Tested ${plural(ids.length, 'proxy')}${r.failed.length ? `, ${r.failed.length} request errors` : ''}`, r.failed.length ? 'error' : 'success');
  };
  const remove = async (p, force) => {
    try { await api(`/api/proxies/${p.id}${force ? '?force=1' : ''}`, { method: 'DELETE' }); toast(`Deleted ${p.name}`, 'success'); lib.reload(); }
    catch (e) { if (/assigned/i.test(e.message) && !force) setDialog({ kind: 'force', data: p, msg: e.message }); else toast(e.message, 'error'); }
  };
  const selected = lib.list.filter(p => S.sel.has(p.id));
  return <>
    <header className="page-head"><div><h1>Proxies</h1><div className="muted">{plural(lib.list.length, 'proxy')} in library</div></div>
      <div className="row"><button onClick={() => setDialog({ kind: 'import' })}><Icon name="upload" /> Import</button>
        <button className="primary" onClick={() => setDialog({ kind: 'edit', data: null })}><Icon name="plus" /> Add proxy</button></div></header>
    <div className="toolbar">
      <div className="search"><Icon name="search" /><input type="search" placeholder="Search name, host, username, tags…" value={q} onChange={e => setQ(e.target.value)} /></div>
      <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status filter"><option value="">Any status</option><option value="ok">Working</option><option value="failed">Failing</option><option value="untested">Untested</option></select>
      <select value={tag} onChange={e => setTag(e.target.value)} aria-label="Tag filter"><option value="">All tags</option>{tags.map(t => <option key={t}>{t}</option>)}</select>
    </div>
    {S.sel.size > 0 && <div className="bulkbar"><strong>{S.sel.size} selected</strong>
      <button onClick={() => test([...S.sel])}><Icon name="bolt" /> Test</button>
      <button className="ghost-danger" onClick={() => setDialog({ kind: 'bulk-delete' })}><Icon name="trash" /> Delete</button>
      <button className="ghost" onClick={S.clear}>Clear</button></div>}
    {lib.error && lib.available && <div className="notice warn">{lib.error}</div>}
    <div className="table-wrap"><table className="grid"><thead><tr>
      <th className="cb"><input type="checkbox" aria-label="Select all" checked={S.all} ref={el => el && (el.indeterminate = S.some)} onChange={S.toggleAll} /></th>
      <th>Status</th><th>Name</th><th>Address</th><th>Auth</th><th>Tags</th><th>Profiles</th><th>Last test</th><th></th></tr></thead><tbody>
      {lib.list.map(p => { const st = p.lastTest?.status || 'untested'; return <tr key={p.id} className={S.sel.has(p.id) ? 'selected' : ''}>
        <td className="cb"><input type="checkbox" aria-label={'Select ' + p.name} checked={S.sel.has(p.id)} onChange={() => S.toggle(p.id)} /></td>
        <td><span className={'status ' + ({ ok: 'running', failed: 'error' }[st] || 'stopped')}><i />{testing[p.id] ? 'Testing' : { ok: 'Working', failed: 'Failing', untested: 'Untested' }[st]}</span></td>
        <td className="name">{p.name}</td>
        <td className="mono-sm">{p.type}://{p.host}:{p.port}</td>
        <td>{p.username ? <span title={p.hasPassword ? 'Username and password' : 'Username only'}><Icon name="lock" size={12} /> {p.username}</span> : <span className="muted">None</span>}</td>
        <td>{p.tags.map(t => <button key={t} className="tag" onClick={() => setTag(t)}>{t}</button>)}</td>
        <td>{p.assignedProfiles || <span className="muted">0</span>}</td>
        <td className="small">{p.lastTest?.testedAt ? <>{st === 'ok' ? <span className="ok-text">{p.lastTest.ip} · {p.lastTest.latencyMs} ms</span> : <span className="err-text">{proxyErrorLabel(p.lastTest.error)}</span>}
          <div className="muted">{new Date(p.lastTest.testedAt).toLocaleString()}</div></> : <span className="muted">Never</span>}</td>
        <td className="actions"><button disabled={testing[p.id]} onClick={() => test([p.id])}><Icon name="bolt" /> Test</button>
          <button className="icon-btn" aria-label={'History ' + p.name} title="Latency history" onClick={() => setDialog({ kind: 'history', data: p })}><Icon name="diagnostics" /></button>
          <button className="icon-btn" aria-label={'Edit ' + p.name} title="Edit" onClick={() => setDialog({ kind: 'edit', data: p })}><Icon name="edit" /></button>
          <button className="icon-btn danger" aria-label={'Delete ' + p.name} title="Delete" onClick={() => remove(p, false)}><Icon name="trash" /></button></td>
      </tr>; })}
      {lib.available && !lib.list.length && <tr><td colSpan="9" className="empty">{q || status || tag ? 'No proxies match these filters.' : 'No proxies yet. Add one or import a list.'}</td></tr>}
    </tbody></table></div>
    <ProviderPanel onChanged={lib.reload} />
    {dialog?.kind === 'history' && <LatencyHistory proxy={dialog.data} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'edit' && <ProxyEditor proxy={dialog.data} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); lib.reload(); }} />}
    {dialog?.kind === 'import' && <ImportDialog onClose={() => setDialog(null)} onDone={lib.reload} />}
    {dialog?.kind === 'force' && <Confirm title="Proxy is in use" danger confirmLabel="Unassign and delete" message={`${dialog.msg} Deleting it switches those profiles to a direct connection.`} onConfirm={() => remove(dialog.data, true)} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'bulk-delete' && <Confirm title={`Delete ${plural(selected.length, 'proxy')}`} danger confirmLabel="Delete" message={`Delete ${plural(selected.length, 'proxy')}? Any profiles using them switch to a direct connection.`}
      onConfirm={async () => { const r = await runAll(selected, p => api(`/api/proxies/${p.id}?force=1`, { method: 'DELETE' })); toast(`Deleted ${r.ok}${r.failed.length ? `, ${r.failed.length} failed` : ''}`, r.failed.length ? 'error' : 'success'); lib.reload(); }} onClose={() => setDialog(null)} />}
  </>;
}

function ProxyEditor({ proxy, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(() => proxy ? { ...proxy, password: '', tags: proxy.tags.join(', ') } : { name: '', type: 'http', host: '', port: '', username: '', password: '', tags: '' });
  const [clearPw, setClearPw] = useState(false), [result, setResult] = useState(null), [saving, setSaving] = useState(false);
  const set = (k, v) => setF({ ...f, [k]: v });
  const save = async (andTest) => {
    if (!f.host.trim() || !f.port) return toast('Host and port are required', 'error');
    const body = { name: f.name.trim() || undefined, type: f.type, host: f.host.trim(), port: Number(f.port), username: f.username, tags: f.tags.split(',').map(t => t.trim()).filter(Boolean) };
    if (f.password || !proxy) body.password = f.password; else if (clearPw) body.password = '';
    setSaving(true);
    try {
      const p = await api(proxy ? `/api/proxies/${proxy.id}` : '/api/proxies', { method: proxy ? 'PATCH' : 'POST', body });
      if (andTest) { setResult({ busy: true }); const r = await api(`/api/proxies/${p.id}/test`, { method: 'POST' }); setResult(r); setSaving(false); if (!r.ok) return; }
      toast(proxy ? 'Proxy saved' : 'Proxy added', 'success'); onSaved();
    } catch (e) { toast(e.message, 'error'); setResult(null); }
    setSaving(false);
  };
  return <Dialog title={proxy ? 'Edit proxy' : 'Add proxy'} onClose={onClose} footer={<><ProxyTestResult r={result} /><span className="grow" />
    <button onClick={onClose}>Cancel</button><button disabled={saving} onClick={() => save(true)}>Save and test</button><button className="primary" disabled={saving} onClick={() => save(false)}>Save</button></>}>
    <label>Name<input autoFocus value={f.name} onChange={e => set('name', e.target.value)} placeholder="Defaults to type://host:port" /></label>
    <div className="proxy-grid">
      <label>Type<select value={f.type} onChange={e => set('type', e.target.value)}><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option></select></label>
      <label>Host<input value={f.host} onChange={e => set('host', e.target.value)} placeholder="proxy.example.com" /></label>
      <label>Port<input inputMode="numeric" value={f.port} onChange={e => set('port', e.target.value.replace(/\D/g, ''))} /></label>
      <label className="span2">Username<input value={f.username} onChange={e => set('username', e.target.value)} placeholder="Optional" autoComplete="off" /></label>
      <label>Password<input type="password" value={f.password} disabled={clearPw} onChange={e => set('password', e.target.value)} placeholder={proxy?.hasPassword ? 'Unchanged' : 'Optional'} autoComplete="new-password" /></label>
    </div>
    {proxy?.hasPassword && <label className="check"><input type="checkbox" checked={clearPw} onChange={e => setClearPw(e.target.checked)} /> Remove saved password</label>}
    <label>Tags<input value={f.tags} onChange={e => set('tags', e.target.value)} placeholder="comma, separated" /></label>
    {proxy?.assignedProfiles > 0 && <p className="muted">Used by {plural(proxy.assignedProfiles, 'profile')}. Running profiles pick up changes on their next launch.</p>}
  </Dialog>;
}

function ImportDialog({ onClose, onDone }) {
  const [text, setText] = useState(''), [type, setType] = useState('http'), [tags, setTags] = useState(''), [res, setRes] = useState(null), [busy, setBusy] = useState(false);
  const toast = useToast();
  const lines = text.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).length;
  const run = async () => {
    setBusy(true);
    try { setRes(await api('/api/proxies/import', { method: 'POST', body: { text, defaultType: type, tags: tags.split(',').map(t => t.trim()).filter(Boolean) } })); onDone(); }
    catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return <Dialog wide title="Import proxies" onClose={onClose} footer={res ? <button className="primary" onClick={onClose}>Done</button> : <><button onClick={onClose}>Cancel</button><button className="primary" disabled={!lines || lines > 1000 || busy} onClick={run}>{busy ? 'Importing…' : `Import ${plural(lines, 'line')}`}</button></>}>
    {!res ? <>
      <p className="muted">One per line: <code>host:port</code>, <code>host:port:user:pass</code>, <code>scheme://host:port</code> or <code>scheme://user:pass@host:port</code>. Up to 1000 lines.</p>
      <textarea className="mono-input" rows="10" value={text} onChange={e => setText(e.target.value)} placeholder={'1.2.3.4:8080\nsocks5://user:pass@10.0.0.5:1080'} spellCheck="false" />
      <div className="two"><label>Type for lines without a scheme<select value={type} onChange={e => setType(e.target.value)}><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option></select></label>
        <label>Tags for all imported<input value={tags} onChange={e => setTags(e.target.value)} placeholder="e.g. batch-1" /></label></div>
    </> : <>
      <p><strong>{res.created}</strong> created · <strong>{res.duplicates}</strong> duplicates skipped · <strong className={res.failed ? 'err-text' : ''}>{res.failed}</strong> failed</p>
      {res.failed > 0 && <table className="grid small"><tbody>{res.results.filter(r => !r.ok).map(r => <tr key={r.line}><td className="muted">Line {r.line}</td><td className="mono-sm">{r.input}</td><td className="err-text">{r.error}</td></tr>)}</tbody></table>}
    </>}
  </Dialog>;
}

function LatencyHistory({ proxy, onClose }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(`/api/proxies/${proxy.id}/checks`).then(setRows).catch(e => setError(e.message)); }, [proxy.id]);
  return <Dialog title={`Latency · ${proxy.name}`} onClose={onClose} footer={<button onClick={onClose}>Close</button>}>
    {error && <p className="err-text">{error}</p>}
    {!rows && !error && <p className="muted">Loading recorded checks…</p>}
    {rows && !rows.length && <p className="muted">No local health checks are stored for this proxy yet. Test it to record latency.</p>}
    {!!rows?.length && <table className="grid"><thead><tr><th>When</th><th>Status</th><th>Latency</th><th>Error</th></tr></thead><tbody>
      {rows.map((row, index) => <tr key={row.testedAt + index}><td className="muted">{new Date(row.testedAt).toLocaleString()}</td><td>{row.status}</td><td>{row.latencyMs} ms</td><td>{row.error || ''}</td></tr>)}
    </tbody></table>}
    {proxy.provider && <p className="muted">Provider: {proxy.provider}{proxy.providerMeta?.valid == null ? '' : ` · provider valid: ${proxy.providerMeta.valid}`}</p>}
  </Dialog>;
}
function LegacySummary() {
  const [list, setList] = useState([]);
  useEffect(() => { api('/api/profiles').then(setList).catch(() => {}); }, []);
  const proxies = Object.values(list.filter(p => p.proxy).reduce((m, p) => { const k = `${p.proxy.type}://${p.proxy.host}:${p.proxy.port}`; (m[k] ||= { key: k, auth: !!p.proxy.username, profiles: [] }).profiles.push(p.name); return m; }, {}));
  return <>
    <header className="page-head"><h1>Proxies</h1></header>
    <div className="notice">This server doesn't have the proxy library yet, so proxies are set per profile in the profile editor. Here's a read-only summary.</div>
    <div className="table-wrap"><table className="grid"><thead><tr><th>Proxy</th><th>Auth</th><th>Used by</th></tr></thead><tbody>
      {proxies.map(p => <tr key={p.key}><td className="mono-sm">{p.key}</td><td>{p.auth ? 'Yes' : 'No'}</td><td>{p.profiles.join(', ')}</td></tr>)}
      {!proxies.length && <tr><td colSpan="3" className="empty">No profiles use a proxy yet.</td></tr>}
    </tbody></table></div>
  </>;
}
