import { PortableExportDialog } from '../components/PortableExportDialog.jsx';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toasts.jsx';
import { Confirm, Dialog } from '../components/Dialog.jsx';
import { ProfileDialog, emptyForm } from '../components/ProfileDialog.jsx';
import { StorageDialog } from '../components/StorageDialog.jsx';
import { ProfileAutomationDialog } from '../components/ProfileAutomationDialog.jsx';
import { Icon } from '../components/Icon.jsx';
import { useSelection } from '../hooks/useSelection.js';
import { useProxyLibrary } from '../hooks/useProxyLibrary.js';
import { rowStatus, crashSummary, plural, runAll } from '../lib.js';
import { assignableLibraryProxies, switchProfileProxy } from '../lib/proxySwitch.js';

const COLUMN_DEFS = [['status', 'Status'], ['name', 'Profile name'], ['engine', 'Engine'], ['storage', 'Storage'], ['folder', 'Folder'], ['proxy', 'Proxy'], ['notes', 'Notes'], ['tags', 'Tags'], ['lastused', 'Last used']];
const DEFAULT_COLUMNS = Object.fromEntries(COLUMN_DEFS.map(([key]) => [key, true]));
function loadTablePrefs() {
  try { return JSON.parse(localStorage.getItem('pm.profileTable') || '{}'); } catch { return {}; }
}

export function ProfilesPage({ meta, reloadMeta, folder, setFolder, workspaceFilter = '', onWorkspaceFilterChange, scope = 'all' }) {
  const toast = useToast();
  const [list, setList] = useState([]), [loaded, setLoaded] = useState(false), [loadError, setLoadError] = useState('');
  const [q, setQ] = useState(''), [tag, setTag] = useState(''), [status, setStatus] = useState(''), [proxy, setProxy] = useState(''), [browserEngine, setBrowserEngine] = useState(''), [workspaceId, setWorkspaceId] = useState('');
  const [sort, setSort] = useState({ k: 'updated_at', dir: -1 });
  const initialPrefs = loadTablePrefs();
  const [columns, setColumns] = useState({ ...DEFAULT_COLUMNS, ...(initialPrefs.columns || {}) });
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(initialPrefs.pageSize || 10), [total, setTotal] = useState(0);
  const [views, setViews] = useState([]), [viewName, setViewName] = useState('');
  const [dialog, setDialog] = useState(null), [busy, setBusy] = useState({}), [bulkBusy, setBulkBusy] = useState(false), [bulkJob, setBulkJob] = useState(null);
  const loadGen = useRef(0);
  useEffect(() => { if (workspaceFilter !== workspaceId) setWorkspaceId(workspaceFilter || ''); }, [workspaceFilter]);
  useEffect(() => { setPage(1); }, [scope, folder, workspaceId]);
  useEffect(() => { localStorage.setItem('pm.profileTable', JSON.stringify({ columns, pageSize })); }, [columns, pageSize]);
  const effectiveStatus = scope === 'running' ? 'running' : status;
  const serverSort = sort.k === 'lastused' ? 'last_launched_at' : sort.k;
  const load = useCallback(async () => {
    const mine = ++loadGen.current;
    try {
      const params = { q, tag, folder, status: effectiveStatus, proxy, engine: browserEngine, favorite: scope === 'favorites', sort: serverSort, dir: sort.dir > 0 ? 'asc' : 'desc', page: String(page), pageSize: String(pageSize) };
      if (workspaceId) params.workspaceId = workspaceId;
      const data = await api('/api/profile-table?' + new URLSearchParams(params));
      if (mine === loadGen.current) {
        const lastPage = Math.max(1, Math.ceil(data.total / pageSize));
        if (page > lastPage) setPage(lastPage);
        setList(data.items); setTotal(data.total); setLoadError('');
      }
    } catch (e) { if (mine === loadGen.current) { setLoadError(e.message); toast(e.message, 'error'); } }
    if (mine === loadGen.current) setLoaded(true);
  }, [q, tag, folder, effectiveStatus, proxy, browserEngine, scope, workspaceId, serverSort, sort.dir, page, pageSize, toast]);
  useEffect(() => { const t = setTimeout(load, q ? 180 : 0); return () => clearTimeout(t); }, [load, meta]);
  useEffect(() => { api('/api/views').then(setViews).catch(() => {}); }, [meta]);

  const rows = list;
  const S = useSelection(rows.map(p => p.id));
  const selected = rows.filter(p => S.sel.has(p.id));

  const authHeaders = () => ({ ...(window.pm?.uiToken ? { 'X-UI-Token': window.pm.uiToken } : {}) });
  const exportPortable = async (p, options) => {
    if (p.running) return toast('Stop the profile before exporting a portable backup', 'error');
    setBusy(b => ({ ...b, [p.id]: true }));
    let writable;
    try {
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({ suggestedName: `profile-${p.name.replace(/[^\w.-]+/g, '_')}.pmp`, types: [{ description: 'Encrypted profile backup', accept: { 'application/octet-stream': ['.pmp'] } }] });
        writable = await handle.createWritable();
      }
      const response = await fetch(`/api/profiles/${p.id}/backup/export-stream`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(options) });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || `HTTP ${response.status}`); }
      if (writable) { await response.body.pipeTo(writable); writable = null; } else {
      if (Number(response.headers.get('content-length')) > 64 * 1024 * 1024) { await response.body.cancel(); throw new Error('Large export requires a browser with Save File Picker support or the authenticated streaming API.'); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `profile-${p.name.replace(/[^\w.-]+/g, '_')}.pmp`;
      link.click();
      URL.revokeObjectURL(url);
      }
      toast(`Downloaded portable backup for ${p.name}`, 'success');
      setDialog(null);
    } catch (e) { if (writable) await writable.abort().catch(() => {}); toast(e.message, 'error'); }
    setBusy(b => ({ ...b, [p.id]: false }));
  };
  const act = async (id, label, fn) => {
    setBusy(b => ({ ...b, [id]: true }));
    try { await fn(); if (label) toast(label, 'success'); } catch (e) { toast(e.message, 'error'); }
    setBusy(b => ({ ...b, [id]: false })); load(); reloadMeta();
  };
  const bulkProxySwitch = async proxyId => {
    const ids = selected.map(p => p.id);
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      const r = await runAll(ids, id => switchProfileProxy(id, { proxyId: proxyId || null }), 4);
      toast(`${proxyId ? 'Assigned library proxy on' : 'Switched to direct on'} ${ids.length - r.failed.length} of ${ids.length} profile${ids.length === 1 ? '' : 's'}`, r.failed.length ? 'error' : 'success');
    } catch (e) { toast(e.message, 'error'); }
    setBulkBusy(false);
    load();
    reloadMeta();
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
    const body = { name: f.name, tags: f.tags, folder: f.folder, notes: f.notes, workspaceId: f.workspaceId || null, automationEnabled: !!f.automationEnabled, browserEngine: f.browserEngine || 'chromium', browserSettings: f.browserSettings, webrtcSettings: f.webrtcSettings, advancedSettings: f.advancedSettings, extensionAssignments: f.extensionAssignments || [] };
    if (f.proxyMode !== 'library') body.proxy = f.proxyMode === 'custom' ? { ...f.proxy, port: Number(f.proxy.port) } : null;
    const p = await api(f.id ? `/api/profiles/${f.id}` : '/api/profiles', { method: f.id ? 'PUT' : 'POST', body });
    if (f.proxyMode === 'library' && f.proxyId !== (f.id ? initialProxyId(f) : null)) {
      const r = await switchProfileProxy(p.id, { proxyId: f.proxyId });
      if (r?.appliesOnNextLaunch) toast('Proxy change applies on the next launch');
    } else if (f.proxyMode === 'none' && f.id && initialProxyId(f)) {
      const r = await switchProfileProxy(p.id, { proxyId: null });
      if (r?.appliesOnNextLaunch) toast('Switched to direct connection on next launch');
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
  const sortBy = k => {
    setSort(s => ({ k, dir: s.k === k ? -s.dir : 1 }));
    setPage(1);
  };
  const applyView = id => {
    const view = views.find(item => item.id === id);
    if (!view) return;
    const query = view.query || {};
    setQ(query.q || '');
    setTag(query.tag || '');
    setStatus(query.status || '');
    setProxy(query.proxy || '');
    setBrowserEngine(query.engine || '');
    setSort({ k: query.sort === 'last_launched_at' ? 'lastused' : query.sort || 'updated_at', dir: query.dir === 'asc' ? 1 : -1 });
    setFolder(query.folder ?? '__all', query.favorite === true || query.favorite === 'true' ? 'favorites' : 'all');
    onWorkspaceFilterChange?.(query.workspaceId || '');
    if ([10, 25, 50, 100].includes(Number(query.pageSize))) setPageSize(Number(query.pageSize));
    setPage(1);
  };

  const shown = COLUMN_DEFS.filter(([key]) => columns[key] !== false);
  const one = selected.length === 1 ? selected[0] : null;
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return <>
    {dialog?.kind === 'portable' && <PortableExportDialog profile={dialog.data} busy={!!busy[dialog.data.id]} onClose={() => setDialog(null)} onExport={options => exportPortable(dialog.data, options)} />}
    <div className="toolbar profile-toolbar">
      <button className="primary" data-action="new-profile" aria-label="New profile" onClick={() => setDialog({ kind: 'edit', data: { ...emptyForm, folder: folder === '__all' ? '' : folder } })}><Icon name="plus" /> Create</button>
      <button onClick={async () => { try { await api('/api/profiles/quick', { method: 'POST', body: { folder: folder === '__all' ? '' : folder } }); toast('Quick profile created', 'success'); load(); reloadMeta(); } catch (e) { toast(e.message, 'error'); } }}>Quick</button>
      <button aria-label="Start selected" disabled={!selected.some(p => !p.running) || bulkBusy} onClick={() => serverBulk('Launched', { action: 'launch', ids: selected.filter(p => !p.running).map(p => p.id), concurrency: 2 })}><Icon name="play" /></button>
      <button aria-label="Stop selected" disabled={!selected.some(p => p.running) || bulkBusy} onClick={() => serverBulk('Stopped', { action: 'stop', ids: selected.filter(p => p.running).map(p => p.id), concurrency: 4 })}><Icon name="stop" /></button>
      <button aria-label="Restart selected" title="Restart stops the browser and launches it again" disabled={!one?.running || bulkBusy} onClick={() => act(one.id, `Restarted ${one.name}`, async () => { await api(`/api/profiles/${one.id}/stop`, { method: 'POST' }); await api(`/api/profiles/${one.id}/launch`, { method: 'POST' }); })}><Icon name="bolt" /></button>
      <button aria-label="Edit selected" disabled={!one} onClick={() => setDialog({ kind: 'edit', data: toForm(one) })}><Icon name="edit" /></button>
      <button aria-label="Duplicate selected" disabled={!one || busy[one?.id]} onClick={() => act(one.id, `Cloned ${one.name}`, () => api(`/api/profiles/${one.id}/clone`, { method: 'POST', body: { mode: 'settings' } }))}><Icon name="copy" /></button>
      <button aria-label="Clone selected settings" disabled={!selected.length || bulkBusy} onClick={() => serverBulk('Cloned settings for', { action: 'clone', ids: selected.map(p => p.id) })}>Clone settings</button>
      <button aria-label="Move selected" disabled={!selected.length || bulkBusy} onClick={() => setDialog({ kind: 'bulk-move' })}><Icon name="folder" /></button>
      <button aria-label="Tag selected" disabled={!selected.length || bulkBusy} onClick={() => setDialog({ kind: 'bulk-tag' })}><Icon name="tag" /></button>
      <button onClick={() => setDialog({ kind: 'import' })}>Import</button>
      <button aria-label="Export selected" disabled={!one || one.running} onClick={() => setDialog({ kind: 'portable', data: one })}>Export</button>
      <button className="ghost-danger" aria-label="Delete selected" disabled={!selected.length || bulkBusy} onClick={() => selected.length === 1 ? setDialog({ kind: 'delete', data: selected[0] }) : setDialog({ kind: 'bulk-delete' })}><Icon name="trash" /></button>
      <div className="search"><Icon name="search" /><input type="search" placeholder="Search" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} /></div>
      <button type="button" aria-expanded={columnsOpen} onClick={() => setColumnsOpen(v => !v)}>Columns</button>
    </div>
    {columnsOpen && <div className="column-picker" role="group" aria-label="Visible columns">{COLUMN_DEFS.map(([key, label]) => <label key={key} className="check"><input type="checkbox" checked={columns[key] !== false} onChange={e => setColumns(current => ({ ...current, [key]: e.target.checked }))} />{label}</label>)}</div>}
    <div className="toolbar filters">
      <select value={effectiveStatus} disabled={scope === 'running'} onChange={e => { setStatus(e.target.value); setPage(1); }} aria-label="Status filter"><option value="">Any status</option><option value="running">Running</option><option value="stopped">Stopped</option><option value="error">Error</option></select>
      <select value={tag} onChange={e => { setTag(e.target.value); setPage(1); }} aria-label="Tag filter"><option value="">All tags</option>{meta.tags.map(t => <option key={t}>{t}</option>)}</select>
      <select value={proxy} onChange={e => { setProxy(e.target.value); setPage(1); }} aria-label="Proxy filter"><option value="">Any proxy</option><option value="none">Direct</option><option value="assigned">Assigned proxy</option></select>
      <select value={browserEngine} onChange={e => { setBrowserEngine(e.target.value); setPage(1); }} aria-label="Browser engine filter"><option value="">Any engine</option><option value="chromium">Chromium</option><option value="firefox">Firefox</option></select>
      {workspaceId && <span className="tag">Workspace filter active <button type="button" className="link" onClick={() => { setWorkspaceId(''); onWorkspaceFilterChange?.(''); setPage(1); }}>Clear</button></span>}
      <select aria-label="Saved view" value="" onChange={event => applyView(event.target.value)}>
        <option value="">Saved views</option>{views.map(view => <option key={view.id} value={view.id}>{view.name}</option>)}</select>
      {(q || tag || status || proxy || browserEngine) && <button className="ghost" onClick={() => { setQ(''); setTag(''); setStatus(''); setProxy(''); setBrowserEngine(''); setPage(1); }}>Clear filters</button>}
      <input aria-label="View name" value={viewName} onChange={e => setViewName(e.target.value)} placeholder="Save view as…" />
      <button disabled={!viewName.trim()} onClick={async () => { try { const view = await api('/api/views', { method: 'POST', body: { name: viewName.trim(), query: { q, tag, folder, status: effectiveStatus, proxy, engine: browserEngine, workspaceId, favorite: scope === 'favorites', sort: serverSort, dir: sort.dir > 0 ? 'asc' : 'desc', pageSize } } }); setViews(items => [...items, view]); setViewName(''); toast('View saved', 'success'); } catch (e) { toast(e.message, 'error'); } }}>Save view</button>
      <span className="muted">{scope === 'running' ? 'Running' : scope === 'favorites' ? 'Favorites' : folder === '__all' ? 'All profiles' : folder || 'No folder'} · {plural(total, 'profile')} · {meta.running.length} running</span>
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
    <div className="table-wrap"><table className="grid profiles"><thead><tr>
      <th className="cb"><input type="checkbox" aria-label="Select all" checked={S.all} ref={el => el && (el.indeterminate = S.some)} onChange={S.toggleAll} /></th>
      <th className="fav"></th>
      {shown.map(([k, l]) => <th key={k} className={'sortable col-' + k} onClick={() => sortBy(k)} aria-sort={sort.k === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>{l}{sort.k === k && <Icon name={sort.dir > 0 ? 'up' : 'down'} size={12} />}</th>)}
      <th className="col-actions"></th></tr></thead><tbody>
      {rows.map(p => { const st = rowStatus(p, busy[p.id]); return <tr key={p.id} className={S.sel.has(p.id) ? 'selected' : ''}>
        <td className="cb"><input type="checkbox" aria-label={'Select ' + p.name} checked={S.sel.has(p.id)} onChange={() => S.toggle(p.id)} /></td>
        <td className="fav"><button type="button" className="icon-btn" disabled={busy[p.id]} aria-label={`Favorite ${p.name}`} aria-pressed={p.favorite} title={p.favorite ? 'Remove favorite' : 'Add favorite'}
          onClick={() => act(p.id, null, () => api(`/api/profiles/${p.id}/favorite`, { method: 'PATCH', body: { favorite: !p.favorite } }))}>
          {p.favorite ? <span aria-hidden="true">★</span> : <Icon name="star" size={14} />}
        </button><button type="button" className="icon-btn launch" aria-label={(p.running ? 'Stop ' : 'Launch ') + p.name} disabled={busy[p.id]} onClick={() => p.running ? act(p.id, `Stopped ${p.name}`, () => api(`/api/profiles/${p.id}/stop`, { method: 'POST' })) : act(p.id, `Launched ${p.name}`, () => api(`/api/profiles/${p.id}/launch`, { method: 'POST' }))}><Icon name={p.running ? 'stop' : 'play'} size={14} /></button></td>
        {columns.status !== false && <td className="col-status"><span className={'status ' + st.key}><i />{st.label}</span></td>}
        {columns.name !== false && <td className="col-name"><div className="name-line"><span className="name">{p.name}</span>{p.isQuick && <span className="tag" title="Quick profile">quick</span>}</div>
          {st.showError && <div className="err-text small clamp" title={p.last_error}>{crashSummary(p.last_error)}</div>}
          {p.lastProxyLocation && <div className="muted" title={`Last resolved proxy exit ${p.lastProxyLocation.ip}`}>
            Proxy exit {p.lastProxyLocation.ip} · Approx.: {[p.lastProxyLocation.city, p.lastProxyLocation.region, p.lastProxyLocation.country].filter(Boolean).join(', ')} · {p.lastProxyLocation.timezone} · {Number.isFinite(p.lastProxyLocation.utcOffsetMinutes) ? 'UTC offset ' + (p.lastProxyLocation.utcOffsetMinutes >= 0 ? '+' : '') + p.lastProxyLocation.utcOffsetMinutes + ' min · ' : ''}{p.lastProxyLocation.latitude?.toFixed(2)}, {p.lastProxyLocation.longitude?.toFixed(2)} · {p.lastProxyLocation.radiusKm == null ? 'Provider accuracy radius unavailable' : p.lastProxyLocation.radiusKm + ' km provider radius'} · {p.lastProxyLocation.source} · {p.lastProxyLocation.browserVerifiedAt ? 'Browser exit, timezone and coordinates checked at launch' : p.lastProxyLocation.browserTimezoneVerifiedAt ? 'Browser exit and timezone checked at launch' : p.lastProxyLocation.browserExitVerifiedAt ? 'Browser exit checked at launch' : 'Proxy probe only'} · {new Date(p.lastProxyLocation.browserExitVerifiedAt || p.lastProxyLocation.expiresAt - 86_400_000).toLocaleString()}
          </div>}
          {['azwah-native', 'custom-native-chromium'].includes(p.advancedSettings?.runtime) && p.browserEngine !== 'firefox' && <div className="muted small">
            {p.proxy && <>
              Proxy exit: {p.running && p.lastProxyLocation?.browserExitVerifiedAt ? 'Verified at startup' : 'No current browser verification'} ·{' '}
              Location: {p.running && p.lastProxyLocation ? 'Approximate GeoIP' : 'No current GeoIP result'} ·{' '}
              Timezone: {p.running && p.lastProxyLocation?.nativeTimezoneVerifiedAt ? 'Native ICU checked at startup' : 'No current browser verification'}
              {' · '}Geolocation API, DNS and WebRTC: Not verified
            </>}
            {' '}<span title="Azwah has no provisioned virtual network adapter for this profile.">MAC isolation: Unavailable</span>
          </div>}
          {p.automationEnabled && !p.running && <div className="muted">Automation enabled</div>}
          {p.tabRestore?.enabled && <span className="tag" title={p.running ? 'Tab restore on — saved on graceful stop' : p.tabRestore.savedCount ? `${p.tabRestore.savedCount} tab(s) saved for next launch` : 'Tab restore on — no saved tabs yet'}>Tab restore{p.tabRestore.savedCount ? ` · ${p.tabRestore.savedCount}` : ''}</span>}
          {p.cdp && <div className="mono" title="Automation endpoint">{p.cdp.wsEndpoint || p.cdp.debuggerAddress}</div>}</td>}
        {columns.engine !== false && <td className="col-engine">{p.browserEngine === 'firefox' ? 'Firefox' : ['azwah-native', 'custom-native-chromium'].includes(p.advancedSettings?.runtime) ? 'Azwah Native Chromium (development)' : p.advancedSettings?.runtime === 'privacy' ? 'Azwah Privacy Engine (experimental)' : p.advancedSettings?.runtime === 'stable-chrome' ? 'Google Chrome Stable' : 'Chromium'}</td>}
        {columns.storage !== false && <td className="col-storage" title="Stored in the local data folder">Local</td>}
        {columns.folder !== false && <td className="col-folder">{p.folder ? <button className="link" onClick={() => setFolder(p.folder)}>{p.folder}</button> : <span className="muted">None</span>}</td>}
        {columns.proxy !== false && <td className="col-proxy">{p.proxy ? <span className="mono-sm" title={`${p.proxy.type}://${p.proxy.host}:${p.proxy.port}`}>{p.proxy.name || `${p.proxy.host}:${p.proxy.port}`}{(p.proxy.username || p.proxy.hasPassword) && <Icon name="lock" size={12} />}</span> : <span className="muted">Direct</span>}</td>}
        {columns.notes !== false && <td className="col-notes"><span className="clamp" title={p.notes || ''}>{p.notes || ''}</span></td>}
        {columns.tags !== false && <td className="col-tags">{p.tags.map(t => <button key={t} className="tag" onClick={() => setTag(t)}>{t}</button>)}</td>}
        {columns.lastused !== false && <td className="col-lastused muted">{p.last_launched_at ? new Date(p.last_launched_at).toLocaleString() : '—'}</td>}
        <td className="actions col-actions">
          {p.running ? <>
            <button disabled={busy[p.id]} onClick={() => act(p.id, null, async () => {
              const r = await api(`/api/profiles/${p.id}/browser/focus`, { method: 'POST' });
              if (!r.ok) throw new Error(r.reason || 'Could not focus browser window');
            })} title="Bring browser window to front">Focus</button>
            <button disabled={busy[p.id]} onClick={() => act(p.id, `Stopped ${p.name}`, () => api(`/api/profiles/${p.id}/stop`, { method: 'POST' }))}><Icon name="stop" /> Stop</button>
          </> : <button className="primary" disabled={busy[p.id]} onClick={() => act(p.id, `Launched ${p.name}`, () => api(`/api/profiles/${p.id}/launch`, { method: 'POST' }))}><Icon name="play" /> {busy[p.id] ? 'Starting…' : 'Launch'}</button>}
          {p.automationEnabled && <button className="icon-btn" title="Automation (CDP / WebDriver)" aria-label={'Automation ' + p.name} onClick={() => setDialog({ kind: 'automation', data: p })}><Icon name="bolt" size={14} /></button>}
          <button className="icon-btn" title="Proxy connection" aria-label={'Proxy ' + p.name} onClick={() => setDialog({ kind: 'proxy-switch', data: p })}><Icon name="proxies" size={14} /></button>
          <button className="icon-btn" title="Storage" aria-label={'Storage ' + p.name} onClick={() => setDialog({ kind: 'storage', data: p })}><Icon name="storage" /></button>
          <button className="icon-btn" title="Export portable .pmp backup" aria-label={'Export ' + p.name} disabled={busy[p.id] || p.running} onClick={() => setDialog({ kind: 'portable', data: p })}><Icon name="download" /></button>
          <button className="icon-btn" title="Edit" aria-label={'Edit ' + p.name} onClick={() => setDialog({ kind: 'edit', data: toForm(p) })}><Icon name="edit" /></button>
          <button className="icon-btn" title="Clone" aria-label={'Clone ' + p.name} disabled={busy[p.id]} onClick={() => act(p.id, `Cloned ${p.name}`, () => api(`/api/profiles/${p.id}/clone`, { method: 'POST', body: { mode: 'settings' } }))}><Icon name="copy" /></button>
          {p.isQuick && <button className="icon-btn" title="Save as regular profile" aria-label={'Save as regular ' + p.name} disabled={busy[p.id]} onClick={() => act(p.id, `${p.name} saved as regular`, () => api(`/api/profiles/${p.id}/save-regular`, { method: 'POST' }))}><Icon name="check" /></button>}
          <button className="icon-btn" title="Save as template" aria-label={'Template from ' + p.name} disabled={busy[p.id]} onClick={() => setDialog({ kind: 'template', data: p })}><Icon name="templates" size={14} /></button>
          <button className="icon-btn danger" title="Delete" aria-label={'Delete ' + p.name} onClick={() => setDialog({ kind: 'delete', data: p })}><Icon name="trash" /></button>
        </td></tr>; })}
      {!loaded && !rows.length && <tr><td colSpan={shown.length + 3} className="empty" aria-busy="true">Loading profiles…</td></tr>}
      {loaded && !rows.length && <tr><td colSpan={shown.length + 3} className="empty">{total || q || tag || status || proxy ? 'No profiles match these filters.' : <>No profiles yet. <button className="link" onClick={() => setDialog({ kind: 'edit', data: emptyForm })}>Create your first profile</button></>}</td></tr>}
    </tbody></table></div>
    <div className="pager"><span className="muted">Rows per page</span><select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} aria-label="Page size"><option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100">100</option></select><span className="muted">{from}–{to} of {total}</span><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><button disabled={page * pageSize >= total} onClick={() => setPage(value => value + 1)}>Next</button></div>
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
      onApply={proxyId => bulkProxySwitch(proxyId || null)} />}
    {dialog?.kind === 'proxy-switch' && <ProfileProxySwitch profile={dialog.data} onClose={() => setDialog(null)} onDone={() => { load(); reloadMeta(); }} />}
    {dialog?.kind === 'automation' && <ProfileAutomationDialog profile={dialog.data} onClose={() => setDialog(null)} />}
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
  const options = assignableLibraryProxies(lib.list);
  return <Dialog title={`Proxy for ${plural(count, 'profile')}`} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={lib.available === false} onClick={() => { onApply(proxyId || null); onClose(); }}>Apply</button></>}>
    {lib.available === false && <p className="notice warn">The proxy library is not available on this server.</p>}
    {lib.loading && <p className="muted" aria-busy="true">Loading proxy library…</p>}
    {lib.error && <p className="err-text">{lib.error}</p>}
    <label>Connection<select value={proxyId} onChange={e => setProxyId(e.target.value)} disabled={lib.available === false}>
      <option value="">Direct connection</option>
      {options.map(px => <option key={px.id} value={px.id}>{px.name} ({px.type}://{px.host}:{px.port}){px.lastTest?.status === 'failed' ? ' · failing' : ''}</option>)}
    </select></label>
    {!options.length && lib.available && !lib.loading && <p className="muted">No assignable proxies in the library. Add a live proxy on the Proxies page (templates cannot be assigned).</p>}
    <p className="muted">Uses the safe switch API. Running profiles keep the current proxy until the next launch.</p>
  </Dialog>;
}

function ProfileProxySwitch({ profile, onClose, onDone }) {
  const toast = useToast();
  const lib = useProxyLibrary();
  const [proxyId, setProxyId] = useState(profile.proxyId || '');
  const [busy, setBusy] = useState(false);
  const options = assignableLibraryProxies(lib.list);
  const apply = async () => {
    setBusy(true);
    try {
      const r = await switchProfileProxy(profile.id, { proxyId: proxyId || null });
      if (r?.appliesOnNextLaunch) toast('Proxy change applies on the next launch', 'success');
      else toast(proxyId ? 'Library proxy assigned' : 'Direct connection set', 'success');
      onDone();
      onClose();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return <Dialog title={`Proxy · ${profile.name}`} onClose={onClose} footer={<><button onClick={onClose} disabled={busy}>Cancel</button><button className="primary" disabled={busy || lib.available === false} onClick={apply}>{busy ? 'Saving…' : 'Apply'}</button></>}>
    {lib.available === false && <p className="notice warn">Proxy library unavailable — edit the profile to set a custom proxy.</p>}
    {lib.loading && <p className="muted" aria-busy="true">Loading proxies…</p>}
    {lib.error && <p className="err-text">{lib.error}</p>}
    <p className="muted">Current: {profile.proxy ? `${profile.proxy.name || profile.proxy.host}:${profile.proxy.port}` : 'Direct'}</p>
    <label>Connection<select value={proxyId} onChange={e => setProxyId(e.target.value)} disabled={lib.available === false || busy}>
      <option value="">Direct connection</option>
      {options.map(px => <option key={px.id} value={px.id}>{px.name} ({px.type}://{px.host}:{px.port})</option>)}
    </select></label>
    {profile.running && <p className="notice">This profile is running. The browser keeps the current proxy until you stop and launch again.</p>}
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
