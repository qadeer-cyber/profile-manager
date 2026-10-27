import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toasts.jsx';
import { Confirm, Dialog } from '../components/Dialog.jsx';
import { ProfileDialog, emptyForm } from '../components/ProfileDialog.jsx';
import { Icon } from '../components/Icon.jsx';
import { useSelection } from '../hooks/useSelection.js';
import { runAll, statusOf, rowStatus, crashSummary, plural } from '../lib.js';

const COLS = [['status', 'Status'], ['name', 'Name'], ['folder', 'Folder'], ['tags', 'Tags'], ['proxy', 'Proxy'], ['updated_at', 'Updated']];
const sortVal = (p, k) => k === 'status' ? ['running', 'error', 'stopped'].indexOf(statusOf(p)) : k === 'tags' ? p.tags.join(',') : k === 'proxy' ? (p.proxy ? p.proxy.host : '\uffff') : String(p[k] ?? '').toLowerCase();

export function ProfilesPage({ meta, reloadMeta, folder, setFolder }) {
  const toast = useToast();
  const [list, setList] = useState([]), [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState(''), [tag, setTag] = useState(''), [status, setStatus] = useState('');
  const [sort, setSort] = useState({ k: 'updated_at', dir: -1 });
  const [dialog, setDialog] = useState(null), [busy, setBusy] = useState({}), [bulkBusy, setBulkBusy] = useState(false);
  const loadGen = useRef(0);
  const load = useCallback(async () => {
    const mine = ++loadGen.current;
    try {
      const rows = await api('/api/profiles?' + new URLSearchParams({ q, tag, folder }));
      if (mine === loadGen.current) setList(rows);
    } catch (e) { if (mine === loadGen.current) toast(e.message, 'error'); }
    if (mine === loadGen.current) setLoaded(true);
  }, [q, tag, folder, toast]);
  useEffect(() => { const t = setTimeout(load, q ? 180 : 0); return () => clearTimeout(t); }, [load, meta]);

  const rows = useMemo(() => list.filter(p => !status || statusOf(p) === status)
    .sort((a, b) => { const x = sortVal(a, sort.k), y = sortVal(b, sort.k); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; }), [list, status, sort]);
  const S = useSelection(rows.map(p => p.id));
  const selected = rows.filter(p => S.sel.has(p.id));

  const act = async (id, label, fn) => {
    setBusy(b => ({ ...b, [id]: true }));
    try { await fn(); if (label) toast(label, 'success'); } catch (e) { toast(e.message, 'error'); }
    setBusy(b => ({ ...b, [id]: false })); load(); reloadMeta();
  };
  const bulk = async (verb, items, fn) => {
    setBulkBusy(true);
    const r = await runAll(items, fn);
    setBulkBusy(false); load(); reloadMeta();
    if (r.failed.length) toast(`${verb}: ${r.ok} done, ${r.failed.length} failed. ${r.failed[0].item.name}: ${r.failed[0].error}`, 'error');
    else toast(`${verb} ${plural(r.ok, 'profile')}`, 'success');
  };
  const save = f => act('dlg', f.id ? 'Profile saved' : 'Profile created', async () => {
    const body = { name: f.name, tags: f.tags, folder: f.folder, notes: f.notes, automationEnabled: !!f.automationEnabled };
    if (f.proxyMode !== 'library') body.proxy = f.proxyMode === 'custom' ? { ...f.proxy, port: Number(f.proxy.port) } : null;
    const p = await api(f.id ? `/api/profiles/${f.id}` : '/api/profiles', { method: f.id ? 'PUT' : 'POST', body });
    if (f.proxyMode === 'library' && f.proxyId !== (f.id ? initialProxyId(f) : null)) {
      const r = await api(`/api/profiles/${p.id}/proxy`, { method: 'POST', body: { proxyId: f.proxyId } });
      if (r?.appliesOnNextLaunch) toast('Proxy change applies on the next launch');
    }
    setDialog(null);
  });
  const toForm = p => ({ ...emptyForm, ...p, _orig: p.proxyId || null, tags: p.tags.join(', '), proxyId: p.proxyId || '',
    proxyMode: p.proxyId ? 'library' : p.proxy ? 'custom' : 'none', proxy: p.proxy ? { username: '', password: '', ...p.proxy } : emptyForm.proxy });
  const initialProxyId = f => f._orig;
  const sortBy = k => setSort(s => ({ k, dir: s.k === k ? -s.dir : 1 }));

  return <>
    <header className="page-head">
      <div><h1>{folder === '__all' ? 'All profiles' : folder || 'No folder'}</h1>
        <div className="muted">{plural(list.length, 'profile')} · {meta.running.length} running</div></div>
      <button className="primary" onClick={() => setDialog({ kind: 'edit', data: { ...emptyForm, folder: folder === '__all' ? '' : folder } })}><Icon name="plus" /> New profile</button>
    </header>
    <div className="toolbar">
      <div className="search"><Icon name="search" /><input type="search" placeholder="Search name, notes, tags, folder…" value={q} onChange={e => setQ(e.target.value)} /></div>
      <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status filter"><option value="">Any status</option><option value="running">Running</option><option value="stopped">Stopped</option><option value="error">Error</option></select>
      <select value={tag} onChange={e => setTag(e.target.value)} aria-label="Tag filter"><option value="">All tags</option>{meta.tags.map(t => <option key={t}>{t}</option>)}</select>
      {(q || tag || status) && <button className="ghost" onClick={() => { setQ(''); setTag(''); setStatus(''); }}>Clear filters</button>}
    </div>
    {S.sel.size > 0 && <div className="bulkbar" role="toolbar" aria-label="Bulk actions">
      <strong>{S.sel.size} selected</strong>
      <button disabled={bulkBusy} onClick={() => bulk('Launched', selected.filter(p => !p.running), p => api(`/api/profiles/${p.id}/launch`, { method: 'POST' }))}><Icon name="play" /> Launch</button>
      <button disabled={bulkBusy} onClick={() => bulk('Stopped', selected.filter(p => p.running), p => api(`/api/profiles/${p.id}/stop`, { method: 'POST' }))}><Icon name="stop" /> Stop</button>
      <button disabled={bulkBusy} onClick={() => setDialog({ kind: 'bulk-tag' })}><Icon name="tag" /> Tags</button>
      <button disabled={bulkBusy} onClick={() => setDialog({ kind: 'bulk-move' })}><Icon name="folder" /> Move</button>
      <button disabled={bulkBusy} className="ghost-danger" onClick={() => setDialog({ kind: 'bulk-delete' })}><Icon name="trash" /> Delete</button>
      <button className="ghost" onClick={S.clear}>Clear</button>
      {bulkBusy && <span className="muted">Working…</span>}
    </div>}
    <div className="table-wrap"><table className="grid"><thead><tr>
      <th className="cb"><input type="checkbox" aria-label="Select all" checked={S.all} ref={el => el && (el.indeterminate = S.some)} onChange={S.toggleAll} /></th>
      {COLS.map(([k, l]) => <th key={k} className={'sortable col-' + k} onClick={() => sortBy(k)} aria-sort={sort.k === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>{l}{sort.k === k && <Icon name={sort.dir > 0 ? 'up' : 'down'} size={12} />}</th>)}
      <th className="col-actions"></th></tr></thead><tbody>
      {rows.map(p => { const st = rowStatus(p, busy[p.id]); return <tr key={p.id} className={S.sel.has(p.id) ? 'selected' : ''}>
        <td className="cb"><input type="checkbox" aria-label={'Select ' + p.name} checked={S.sel.has(p.id)} onChange={() => S.toggle(p.id)} /></td>
        <td className="col-status"><span className={'status ' + st.key}><i />{st.label}</span></td>
        <td className="col-name"><div className="name">{p.name}</div>{p.notes && <div className="muted clamp">{p.notes}</div>}
          {st.showError && <div className="err-text small clamp" title={p.last_error}>{crashSummary(p.last_error)}</div>}
          {p.automationEnabled && !p.running && <div className="muted">Automation enabled</div>}
          {p.cdp && <div className="mono" title="Automation (CDP) endpoint">{p.cdp.wsEndpoint}</div>}</td>
        <td className="col-folder">{p.folder ? <button className="link" onClick={() => setFolder(p.folder)}>{p.folder}</button> : <span className="muted">None</span>}</td>
        <td className="col-tags">{p.tags.map(t => <button key={t} className="tag" onClick={() => setTag(t)}>{t}</button>)}</td>
        <td className="col-proxy">{p.proxy ? <span className="mono-sm" title={`${p.proxy.type}://${p.proxy.host}:${p.proxy.port}`}>{p.proxy.name || `${p.proxy.host}:${p.proxy.port}`}{(p.proxy.username || p.proxy.hasPassword) && <Icon name="lock" size={12} />}</span> : <span className="muted">Direct</span>}</td>
        <td className="col-updated muted">{p.updated_at ? new Date(p.updated_at).toLocaleDateString() : ''}</td>
        <td className="actions col-actions">
          {p.running ? <button disabled={busy[p.id]} onClick={() => act(p.id, `Stopped ${p.name}`, () => api(`/api/profiles/${p.id}/stop`, { method: 'POST' }))}><Icon name="stop" /> Stop</button>
            : <button className="primary" disabled={busy[p.id]} onClick={() => act(p.id, `Launched ${p.name}`, () => api(`/api/profiles/${p.id}/launch`, { method: 'POST' }))}><Icon name="play" /> {busy[p.id] ? 'Starting…' : 'Launch'}</button>}
          <button className="icon-btn" title="Edit" aria-label={'Edit ' + p.name} onClick={() => setDialog({ kind: 'edit', data: toForm(p) })}><Icon name="edit" /></button>
          <button className="icon-btn" title="Clone" aria-label={'Clone ' + p.name} disabled={busy[p.id]} onClick={() => act(p.id, `Cloned ${p.name}`, () => api(`/api/profiles/${p.id}/clone`, { method: 'POST' }))}><Icon name="copy" /></button>
          <button className="icon-btn danger" title="Delete" aria-label={'Delete ' + p.name} onClick={() => setDialog({ kind: 'delete', data: p })}><Icon name="trash" /></button>
        </td></tr>; })}
      {loaded && !rows.length && <tr><td colSpan="8" className="empty">{list.length || q || tag || status ? 'No profiles match these filters.' : <>No profiles yet. <button className="link" onClick={() => setDialog({ kind: 'edit', data: emptyForm })}>Create your first profile</button></>}</td></tr>}
    </tbody></table></div>
    {dialog?.kind === 'edit' && <ProfileDialog initial={dialog.data} folders={meta.folders} onSave={save} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'delete' && <Confirm title="Delete profile" danger confirmLabel="Delete" message={`Delete “${dialog.data.name}” and all of its browser data (cookies, storage, cache)? This can't be undone.`}
      onConfirm={() => act(dialog.data.id, `Deleted ${dialog.data.name}`, () => api(`/api/profiles/${dialog.data.id}`, { method: 'DELETE' }))} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'bulk-delete' && <Confirm title={`Delete ${plural(selected.length, 'profile')}`} danger confirmLabel="Delete all"
      message={`Delete ${plural(selected.length, 'profile')} and all of their browser data? Running profiles are stopped first. This can't be undone.`}
      onConfirm={() => bulk('Deleted', selected, async p => { if (p.running) await api(`/api/profiles/${p.id}/stop`, { method: 'POST' }); await api(`/api/profiles/${p.id}`, { method: 'DELETE' }); })} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'bulk-move' && <BulkMove count={selected.length} folders={meta.folders} onClose={() => setDialog(null)}
      onApply={to => bulk('Moved', selected, p => api(`/api/profiles/${p.id}`, { method: 'PUT', body: { folder: to } }))} />}
    {dialog?.kind === 'bulk-tag' && <BulkTags count={selected.length} tags={meta.tags} onClose={() => setDialog(null)}
      onApply={(add, remove) => bulk('Updated tags on', selected, p => api(`/api/profiles/${p.id}`, { method: 'PUT', body: { tags: [...new Set([...p.tags.filter(t => !remove.includes(t)), ...add])] } }))} />}
  </>;
}

function BulkMove({ count, folders, onApply, onClose }) {
  const [to, setTo] = useState('');
  return <Dialog title={`Move ${plural(count, 'profile')}`} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" onClick={() => { onApply(to.trim()); onClose(); }}>Move</button></>}>
    <label>Destination folder<input autoFocus list="pm-folders-bulk" value={to} onChange={e => setTo(e.target.value)} placeholder="Leave empty for no folder" /></label>
    <datalist id="pm-folders-bulk">{folders.filter(Boolean).map(f => <option key={f} value={f} />)}</datalist>
  </Dialog>;
}
function BulkTags({ count, tags, onApply, onClose }) {
  const [add, setAdd] = useState(''), [remove, setRemove] = useState([]);
  const split = s => s.split(',').map(t => t.trim()).filter(Boolean);
  return <Dialog title={`Edit tags on ${plural(count, 'profile')}`} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button>
    <button className="primary" disabled={!split(add).length && !remove.length} onClick={() => { onApply(split(add), remove); onClose(); }}>Apply</button></>}>
    <label>Add tags<input autoFocus value={add} onChange={e => setAdd(e.target.value)} placeholder="comma, separated" /></label>
    {tags.length > 0 && <><div className="label">Remove tags</div><div className="chips">{tags.map(t => <button key={t} className={'tag' + (remove.includes(t) ? ' strike' : '')}
      onClick={() => setRemove(r => r.includes(t) ? r.filter(x => x !== t) : [...r, t])}>{t}</button>)}</div></>}
  </Dialog>;
}
