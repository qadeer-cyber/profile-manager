import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toasts.jsx';
import { Confirm, Dialog } from '../components/Dialog.jsx';
import { ProfileDialog, emptyForm } from '../components/ProfileDialog.jsx';
import { StorageDialog } from '../components/StorageDialog.jsx';
import { Icon } from '../components/Icon.jsx';
import { useSelection } from '../hooks/useSelection.js';
import { useProxyLibrary } from '../hooks/useProxyLibrary.js';
import { rowStatus, crashSummary, plural } from '../lib.js';

const COLS = [['status', 'Status'], ['name', 'Name'], ['folder', 'Folder'], ['tags', 'Tags'], ['proxy', 'Proxy'], ['updated_at', 'Updated']];

export function ProfilesPage({ meta, reloadMeta, folder, setFolder }) {
  const toast = useToast();
  const [list, setList] = useState([]), [loaded, setLoaded] = useState(false), [loadError, setLoadError] = useState('');
  const [q, setQ] = useState(''), [tag, setTag] = useState(''), [status, setStatus] = useState(''), [proxy, setProxy] = useState('');
  const [sort, setSort] = useState({ k: 'updated_at', dir: -1 });
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(50), [total, setTotal] = useState(0);
  const [views, setViews] = useState([]), [viewName, setViewName] = useState('');
  const [dialog, setDialog] = useState(null), [busy, setBusy] = useState({}), [bulkBusy, setBulkBusy] = useState(false), [bulkJob, setBulkJob] = useState(null);
  const loadGen = useRef(0);
  const load = useCallback(async () => {
    const mine = ++loadGen.current;
    try {
      const data = await api('/api/profile-table?' + new URLSearchParams({ q, tag, folder, status, proxy, sort: sort.k, dir: sort.dir > 0 ? 'asc' : 'desc', page: String(page), pageSize: String(pageSize) }));
      if (mine === loadGen.current) { setList(data.items); setTotal(data.total); setLoadError(''); }
    } catch (e) { if (mine === loadGen.current) { setLoadError(e.message); toast(e.message, 'error'); } }
    if (mine === loadGen.current) setLoaded(true);
  }, [q, tag, folder, status, proxy, sort, page, pageSize, toast]);
  useEffect(() => { const t = setTimeout(load, q ? 180 : 0); return () => clearTimeout(t); }, [load, meta]);
  useEffect(() => { api('/api/views').then(setViews).catch(() => {}); }, [meta]);

  const rows = useMemo(() => [...list].sort((a, b) => {
    const value = profile => sort.k === 'status' ? (profile.running ? 0 : profile.last_error ? 1 : 2) : sort.k === 'tags' ? profile.tags.join(',') : sort.k === 'proxy' ? (profile.proxy ? profile.proxy.host : '') : String(profile[sort.k] ?? '').toLowerCase();
    const left = value(a), right = value(b);
    if (left === right) return 0;
    if (left === '') return 1;
    if (right === '') return -1;
    return (left < right ? -1 : 1) * sort.dir;
  }), [list, sort]);
  const S = useSelection(rows.map(p => p.id));
  const selected = rows.filter(p => S.sel.has(p.id));

  const act = async (id, label, fn) => {
    setBusy(b => ({ ...b, [id]: true }));
    try { await fn(); if (label) toast(label, 'success'); } catch (e) { toast(e.message, 'error'); }
    setBusy(b => ({ ...b, [id]: false })); load(); reloadMeta();
  };
  const serverBulk = async (verb, body) => {
    if (Array.isArray(body.ids) && !body.ids.length) return;
    setBulkBusy(true); setBulkJob(null);
    try {
      let state = await api('/api/bulk/jobs', { method: 'POST', body });
      setBulkJob(state);
      while (state.status === 'running' || state.status === 'queued') {
        await new Promise(resolve => setTimeout(resolve, 150));
        state = await api(`/api/bulk/jobs/${state.id}`);
        setBulkJob(state);
      }
      const failed = (state.items || []).filter(item => item.ok === false);
      if (state.status === 'failed' && !failed.length) toast(state.error || `${verb} failed`, 'error');
      else if (failed.length) toast(`${verb}: ${state.items.length - failed.length} done, ${failed.length} failed. ${failed[0].message || failed[0].error}`, 'error');
      else toast(`${verb} ${plural(state.total, 'profile')}`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    setBulkBusy(false); load(); reloadMeta();
  };
  const save = async f => {
    setBusy(b => ({ ...b, dlg: true }));
    try { await (async () => {
    const body = { name: f.name, tags: f.tags, folder: f.folder, notes: f.notes, automationEnabled: !!f.automationEnabled, browserEngine: f.browserEngine || 'chromium', browserSettings: f.browserSettings, webrtcSettings: f.webrtcSettings, advancedSettings: f.advancedSettings, extensionAssignments: f.extensionAssignments || [] };
    if (f.proxyMode !== 'library') body.proxy = f.proxyMode === 'custom' ? { ...f.proxy, port: Number(f.proxy.port) } : null;
    const p = await api(f.id ? `/api/profiles/${f.id}` : '/api/profiles', { method: f.id ? 'PUT' : 'POST', body });
    if (f.proxyMode === 'library' && f.proxyId !== (f.id ? initialProxyId(f) : null)) {
      const r = await api(`/api/profiles/${p.id}/proxy`, { method: 'POST', body: { proxyId: f.proxyId } });
      if (r?.appliesOnNextLaunch) toast('Proxy change applies on the next launch');
    }
    if (p.appliesOnNextLaunch) toast('Saved. Regional settings, WebRTC policy, browser configuration, and extensions apply on the next launch.');
    setDialog(null);
    })(); toast(f.id ? 'Profile saved' : 'Profile created', 'success'); }
    catch (e) { toast(e.message, 'error'); throw e; }
    finally { setBusy(b => ({ ...b, dlg: false })); load(); reloadMeta(); }
  };
  const toForm = p => ({ ...emptyForm, ...p, browserEngine: p.browserEngine || 'chromium', _orig: p.proxyId || null, tags: p.tags.join(', '), proxyId: p.proxyId || '',
    webrtcSettings: p.webrtcSettings || emptyForm.webrtcSettings,
    extensionAssignments: (p.extensions || []).map(e => ({ extensionId: e.id, enabled: !!e.enabled })),
    proxyMode: p.proxyId ? 'library' : p.proxy ? 'custom' : 'none', proxy: p.proxy ? { username: '', password: '', ...p.proxy } : emptyForm.proxy });
  const initialProxyId = f => f._orig;
  const sortBy = k => setSort(s => ({ k, dir: s.k === k ? -s.dir : 1 }));

  return <>
    <header className="page-head">
      <div><h1>{folder === '__all' ? 'All profiles' : folder || 'No folder'}</h1>
        <div className="muted">{plural(total, 'profile')} · {meta.running.length} running</div></div>
      <div className="row"><button onClick={() => setDialog({ kind: 'import' })}>Import</button>
      <button onClick={async () => { try { await api('/api/profiles/quick', { method: 'POST', body: { folder: folder === '__all' ? '' : folder } }); toast('Quick profile created', 'success'); load(); reloadMeta(); } catch (e) { toast(e.message, 'error'); } }}>Quick profile</button>
      <button className="primary" data-action="new-profile" onClick={() => setDialog({ kind: 'edit', data: { ...emptyForm, folder: folder === '__all' ? '' : folder } })}><Icon name="plus" /> New profile</button></div>
    </header>
    <div className="toolbar">
      <div className="search"><Icon name="search" /><input type="search" placeholder="Search name, notes, tags, folder…" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} /></div>
      <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} aria-label="Status filter"><option value="">Any status</option><option value="running">Running</option><option value="stopped">Stopped</option><option value="error">Error</option></select>
      <select value={tag} onChange={e => { setTag(e.target.value); setPage(1); }} aria-label="Tag filter"><option value="">All tags</option>{meta.tags.map(t => <option key={t}>{t}</option>)}</select>
      <select value={proxy} onChange={e => { setProxy(e.target.value); setPage(1); }} aria-label="Proxy filter"><option value="">Any proxy</option><option value="none">Direct</option></select>
      <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} aria-label="Page size"><option value="25">25</option><option value="50">50</option><option value="100">100</option></select>
      <select aria-label="Saved view" value="" onChange={e => { const view = views.find(item => item.id === e.target.value); if (!view) return; const query = view.query || {}; setQ(query.q || ''); setTag(query.tag || ''); setStatus(query.status || ''); setProxy(query.proxy || ''); setPage(1); if (query.sort) setSort({ k: query.sort, dir: query.dir === 'asc' ? 1 : -1 }); if (query.folder != null) setFolder(query.folder || '__all'); }}>
        <option value="">Saved views</option>{views.map(view => <option key={view.id} value={view.id}>{view.name}</option>)}</select>
      {(q || tag || status || proxy) && <button className="ghost" onClick={() => { setQ(''); setTag(''); setStatus(''); setProxy(''); setPage(1); }}>Clear filters</button>}
      <input aria-label="View name" value={viewName} onChange={e => setViewName(e.target.value)} placeholder="Save view as…" />
      <button disabled={!viewName.trim()} onClick={async () => { try { const view = await api('/api/views', { method: 'POST', body: { name: viewName.trim(), query: { q, tag, folder, status, proxy, sort: sort.k, dir: sort.dir > 0 ? 'asc' : 'desc', pageSize } } }); setViews(items => [...items, view]); setViewName(''); toast('View saved', 'success'); } catch (e) { toast(e.message, 'error'); } }}>Save view</button>
    </div>
    {loadError && <div className="notice warn" role="alert">{loadError}</div>}
    {S.sel.size > 0 && <div className="bulkbar" role="toolbar" aria-label="Bulk actions">
      <strong>{S.sel.size} selected</strong>
      <button disabled={bulkBusy} onClick={() => serverBulk('Launched', { action: 'launch', ids: selected.filter(p => !p.running).map(p => p.id), concurrency: 2 })}><Icon name="play" /> Launch</button>
      <button disabled={bulkBusy} onClick={() => serverBulk('Stopped', { action: 'stop', ids: selected.filter(p => p.running).map(p => p.id), concurrency: 4 })}><Icon name="stop" /> Stop</button>
      <button disabled={bulkBusy} onClick={() => setDialog({ kind: 'bulk-tag' })}><Icon name="tag" /> Tags</button>
      <button disabled={bulkBusy} onClick={() => setDialog({ kind: 'bulk-move' })}><Icon name="folder" /> Move</button>
      <button disabled={bulkBusy} onClick={() => setDialog({ kind: 'bulk-proxy' })}>Proxy</button>
      <button disabled={bulkBusy} className="ghost-danger" onClick={() => setDialog({ kind: 'bulk-delete' })}><Icon name="trash" /> Delete</button>
      <button className="ghost" onClick={S.clear}>Clear</button>
      {bulkJob && <span className="muted">{bulkJob.done}/{bulkJob.total}{bulkJob.items?.some(item => item.ok === false) ? ` · ${bulkJob.items.filter(item => item.ok === false).length} failed` : ''}</span>}
      {bulkBusy && !bulkJob && <span className="muted">Working…</span>}
    </div>}
    {bulkJob?.items?.some(item => item.ok === false) && <ul className="import-results">{bulkJob.items.filter(item => item.ok === false).map((item, index) => <li key={item.id || item.index || index} className="bad">{item.id || `Row ${Number(item.index) + 1}`}: {item.message || item.error}</li>)}</ul>}
    <div className="table-wrap"><table className="grid"><thead><tr>
      <th className="cb"><input type="checkbox" aria-label="Select all" checked={S.all} ref={el => el && (el.indeterminate = S.some)} onChange={S.toggleAll} /></th>
      {COLS.map(([k, l]) => <th key={k} className={'sortable col-' + k} onClick={() => sortBy(k)} aria-sort={sort.k === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>{l}{sort.k === k && <Icon name={sort.dir > 0 ? 'up' : 'down'} size={12} />}</th>)}
      <th className="col-actions"></th></tr></thead><tbody>
      {rows.map(p => { const st = rowStatus(p, busy[p.id]); return <tr key={p.id} className={S.sel.has(p.id) ? 'selected' : ''}>
        <td className="cb"><input type="checkbox" aria-label={'Select ' + p.name} checked={S.sel.has(p.id)} onChange={() => S.toggle(p.id)} /></td>
        <td className="col-status"><span className={'status ' + st.key}><i />{st.label}</span></td>
        <td className="col-name"><div className="name">{p.name}{p.isQuick && <span className="tag" title="Quick profile">quick</span>}</div>{p.notes && <div className="muted clamp">{p.notes}</div>}
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
          <button className="icon-btn" title="Storage" aria-label={'Storage ' + p.name} onClick={() => setDialog({ kind: 'storage', data: p })}><Icon name="storage" /></button>
          <button className="icon-btn" title="Edit" aria-label={'Edit ' + p.name} onClick={() => setDialog({ kind: 'edit', data: toForm(p) })}><Icon name="edit" /></button>
          <button className="icon-btn" title="Clone" aria-label={'Clone ' + p.name} disabled={busy[p.id]} onClick={() => act(p.id, `Cloned ${p.name}`, () => api(`/api/profiles/${p.id}/clone`, { method: 'POST' }))}><Icon name="copy" /></button>
          {p.isQuick && <button className="icon-btn" title="Save as regular profile" aria-label={'Save as regular ' + p.name} disabled={busy[p.id]} onClick={() => act(p.id, `${p.name} saved as regular`, () => api(`/api/profiles/${p.id}/save-regular`, { method: 'POST' }))}><Icon name="check" /></button>}
          <button className="icon-btn" title="Save as template" aria-label={'Template from ' + p.name} disabled={busy[p.id]} onClick={() => setDialog({ kind: 'template', data: p })}><Icon name="templates" size={14} /></button>
          <button className="icon-btn danger" title="Delete" aria-label={'Delete ' + p.name} onClick={() => setDialog({ kind: 'delete', data: p })}><Icon name="trash" /></button>
        </td></tr>; })}
      {!loaded && !rows.length && <tr><td colSpan="8" className="empty">Loading profiles…</td></tr>}
      {loaded && !rows.length && <tr><td colSpan="8" className="empty">{total || q || tag || status || proxy ? 'No profiles match these filters.' : <>No profiles yet. <button className="link" onClick={() => setDialog({ kind: 'edit', data: emptyForm })}>Create your first profile</button></>}</td></tr>}
    </tbody></table></div>
    <div className="pager"><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><span className="muted">Page {page} · {total} total</span><button disabled={page * pageSize >= total} onClick={() => setPage(value => value + 1)}>Next</button></div>
    {dialog?.kind === 'edit' && <ProfileDialog initial={dialog.data} folders={meta.folders} onSave={save} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'delete' && <Confirm title="Move to trash" danger confirmLabel="Move to trash" message={`Move “${dialog.data.name}” to trash? You can restore it from the Trash page or delete it permanently later.`}
      onConfirm={() => act(dialog.data.id, `Deleted ${dialog.data.name}`, () => api(`/api/profiles/${dialog.data.id}`, { method: 'DELETE' }))} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'bulk-delete' && <Confirm title={`Trash ${plural(selected.length, 'profile')}`} danger confirmLabel="Move to trash"
      message={`Move ${plural(selected.length, 'profile')} to trash? Running profiles are stopped first.`}
      onConfirm={() => serverBulk('Deleted', { action: 'delete', ids: selected.map(p => p.id), concurrency: 2 })} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'storage' && <StorageDialog profile={dialog.data} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'bulk-move' && <BulkMove count={selected.length} folders={meta.folders} onClose={() => setDialog(null)}
      onApply={to => serverBulk('Moved', { action: 'assign', ids: selected.map(p => p.id), folder: to })} />}
    {dialog?.kind === 'bulk-tag' && <BulkTags count={selected.length} tags={meta.tags} onClose={() => setDialog(null)}
      onApply={(add, remove) => serverBulk('Updated tags on', { action: 'assign', ids: selected.map(p => p.id), addTags: add, removeTags: remove })} />}
    {dialog?.kind === 'bulk-proxy' && <BulkProxy count={selected.length} onClose={() => setDialog(null)}
      onApply={proxyId => serverBulk('Assigned proxy on', { action: 'assign', ids: selected.map(p => p.id), proxyId })} />}
    {dialog?.kind === 'import' && <ImportProfiles onClose={() => setDialog(null)} onDone={() => { load(); reloadMeta(); }} />}
    {dialog?.kind === 'template' && <SaveTemplateDialog profile={dialog.data} onClose={() => setDialog(null)} toast={toast} />}
  </>;
}

function SaveTemplateDialog({ profile, onClose, toast }) {
  const [name, setName] = useState(`${profile.name} template`);
  const [busy, setBusy] = useState(false);
  return <Dialog title="Save as template" onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={async () => {
    setBusy(true);
    try {
      await api('/api/templates', { method: 'POST', body: { profileId: profile.id, name: name.trim() } });
      toast('Template saved', 'success');
      onClose();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  }}>Save</button></>}>
    <p className="muted">Copies engine, proxy, folder, tags (except quick), and browser settings. Does not copy cookies or extensions.</p>
    <label>Template name<input autoFocus value={name} onChange={e => setName(e.target.value)} /></label>
  </Dialog>;
}

function BulkMove({ count, folders, onApply, onClose }) {
  const [to, setTo] = useState('');
  return <Dialog title={`Move ${plural(count, 'profile')}`} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" onClick={() => { onApply(to.trim()); onClose(); }}>Move</button></>}>
    <label>Destination folder<input autoFocus list="pm-folders-bulk" value={to} onChange={e => setTo(e.target.value)} placeholder="Leave empty for no folder" /></label>
    <datalist id="pm-folders-bulk">{folders.filter(Boolean).map(f => <option key={f} value={f} />)}</datalist>
  </Dialog>;
}
function BulkProxy({ count, onApply, onClose }) {
  const lib = useProxyLibrary();
  const [proxyId, setProxyId] = useState('');
  return <Dialog title={`Proxy for ${plural(count, 'profile')}`} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" onClick={() => { onApply(proxyId || null); onClose(); }}>Apply</button></>}>
    {lib.available === false && <p className="muted">The proxy library is not available on this server.</p>}
    <label>Proxy<select value={proxyId} onChange={e => setProxyId(e.target.value)}><option value="">Direct connection</option>{lib.list.map(proxy => <option key={proxy.id} value={proxy.id}>{proxy.name}</option>)}</select></label>
    <p className="muted">A running profile keeps its current proxy until the next launch.</p>
  </Dialog>;
}
function ImportProfiles({ onApply, onClose, onDone }) {
  const toast = useToast();
  const [format, setFormat] = useState('csv');
  const [text, setText] = useState('name,folder,tags,notes\n');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const body = format === 'csv' ? { format, csv: text } : { format, profiles: JSON.parse(text) };
      const rows = await api('/api/bulk/import', { method: 'POST', body });
      setResults(rows);
      const ok = rows.filter(row => row.ok).length;
      toast(`Imported ${ok} of ${rows.length}`, ok === rows.length ? 'success' : 'error');
      if (ok) onDone();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return <Dialog wide title="Import profiles" onClose={onClose} footer={<><button onClick={onClose}>Close</button><button className="primary" disabled={busy} onClick={submit}>Import</button></>}>
    <div className="seg">{[['csv', 'CSV'], ['json', 'JSON']].map(([value, label]) => <button key={value} className={format === value ? 'sel' : ''} onClick={() => { setFormat(value); setResults(null); }}>{label}</button>)}</div>
    <p className="muted">CSV columns: name, folder, tags, notes, locale, timezoneId, languages, startupUrls, proxyId. Lists inside a cell use |. Each row succeeds or fails on its own. Rows that start a cell with =, +, -, or @ are rejected.</p>
    <label>Data<textarea rows="8" value={text} onChange={e => setText(e.target.value)} /></label>
    {results && <ul className="import-results">{results.map(row => <li key={row.index} className={row.ok ? 'ok' : 'bad'}>{row.ok ? `Created ${row.profile.name}` : `Row ${row.index + 1}: ${row.error}`}</li>)}</ul>}
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
