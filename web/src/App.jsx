import { OfficeActivation } from './components/OfficeActivation.jsx';
import React, { useEffect, useState, useCallback, useRef, createContext, useContext } from 'react';
import { api, subscribe } from './api.js';
import { useToast } from './components/Toasts.jsx';
import { ProfileFolderDialog } from './components/ProfileFolderDialog.jsx';
import { ProfilesPage } from './pages/ProfilesPage.jsx';
import { ProxiesPage } from './pages/ProxiesPage.jsx';
import { ExtensionsPage } from './pages/ExtensionsPage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';
import { DiagnosticsPage } from './pages/DiagnosticsPage.jsx';
import { TrashPage } from './pages/TrashPage.jsx';
import { TemplatesPage } from './pages/TemplatesPage.jsx';
import { WorkspacesPage } from './pages/WorkspacesPage.jsx';
import { CookieRobotPage } from './pages/CookieRobotPage.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { MonitoringPage } from './pages/MonitoringPage.jsx';
import { LicenseAdminPage } from '@azwah-admin';
import { Icon } from './components/Icon.jsx';
import { useTheme } from './hooks/useTheme.js';
import { crashSummary, refreshesNow } from './lib.js';
import { shortcutAllowed } from './lib/shortcuts.js';
import { fleetModel } from './lib/fleet.js';

const SHOW_ADMIN = import.meta.env.VITE_AZWAH_ADMIN === '1';

// The profiles header: one bar split by state, so how much of the fleet is live reads at a glance.
function FleetBar({ total, running, errors, proxyFailed, onShow }) {
  const model = fleetModel({ total, running, errors, proxyFailed });
  return <div className="fleet" aria-label="Profile summary">
    <div className="fleet-bar" aria-hidden="true">
      {model.segments.map(seg => <span key={seg.key} className={'fleet-' + seg.key} style={{ width: seg.pct + '%' }} />)}
    </div>
    <div className="fleet-legend">
      {model.keys.map(k => k.scope
        ? <button type="button" key={k.key} className={'fleet-key ' + k.key} onClick={() => onShow(k.scope)}><strong>{k.count}</strong> {k.label}</button>
        : <span key={k.key} className={'fleet-key ' + k.key}><strong>{k.count}</strong> {k.label}</span>)}
      <span className="fleet-key total"><strong>{total}</strong> {total === 1 ? 'profile' : 'profiles'}</span>
    </div>
  </div>;
}
const NAV = [['profiles', 'Profiles'], ['proxies', 'Proxies'], ['extensions', 'Extensions'], ['workspaces', 'Workspaces'], ['cookie-robot', 'Automation'], ...(SHOW_ADMIN ? [['license-admin', 'License admin']] : []), ['diagnostics', 'Help and diagnostics'], ['settings', 'Settings']];
const MORE = [['dashboard', 'Dashboard'], ['templates', 'Templates'], ['monitoring', 'Monitoring'], ['activation', 'Edition']];
export function App() {
  const toast = useToast();
  const [updateRequest, setUpdateRequest] = useState(0);
  const openUpdates = () => { setPage('settings'); setUpdateRequest(count => count + 1); };
  const [update, setUpdate] = useState(null);
  const [remindedVersion, setRemindedVersion] = useState(null);
  useEffect(() => {
    const refresh = () => window.pm?.updateStatus?.().then(setUpdate).catch(() => {});
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, []);
  const [page, setPage] = useState('profiles');
  const [backupRequest, setBackupRequest] = useState(0);
  const [edition, setEdition] = useState(null);
  const [scope, setScope] = useState('all');
  const [folderQuery, setFolderQuery] = useState('');
  const [folderDialog, setFolderDialog] = useState(null);
  useEffect(()=>{api('/api/activation').then(state=>{setEdition(state);if(state.edition==='ultimate')document.title='AZWAH';if(state.edition==='owner-personal')document.title='Azwah Multi Browser Owner';if(state.enforced&&!state.active)setPage('activation');}).catch(()=>{});},[]);
  const [folder, setFolder] = useState('__all');
  const [workspaceFilter, setWorkspaceFilter] = useState('');
  const [theme, setTheme] = useTheme();
  const [compact, setCompact] = useState(() => localStorage.getItem('pm-density') === 'compact');
  useEffect(() => { localStorage.setItem('pm-density', compact ? 'compact' : 'comfortable'); }, [compact]);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1366px)');
    const apply = () => { document.documentElement.dataset.viewport = mq.matches ? '1366' : 'wide'; };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  useEffect(() => {
    let prefix = '';
    const onKey = event => {
      if (!shortcutAllowed(event)) { prefix = ''; return; }
      if (event.key === '/') { event.preventDefault(); document.querySelector(page === 'profiles' ? '.search input' : '.command-search input')?.focus(); return; }
      if ((event.key === 'n' || event.key === 'N') && page === 'profiles') { event.preventDefault(); document.querySelector('[data-action=new-profile]')?.click(); return; }
      if (event.key === 'g') { prefix = 'g'; return; }
      if (prefix === 'g') {
        const map = { d: 'dashboard', p: 'profiles', x: 'proxies', e: 'extensions', m: 'monitoring', s: 'settings', i: 'diagnostics' };
        if (map[event.key]) { setPage(map[event.key]); if (map[event.key] === 'profiles') setFolder('__all'); }
        prefix = '';
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [page]);
  const openFolder = f => { setFolder(f); setWorkspaceFilter(''); setPage('profiles'); };
  const openWorkspaceProfiles = id => { setScope('all'); setWorkspaceFilter(id); setFolder('__all'); setPage('profiles'); };
  const [meta, setMeta] = useState({ tags: [], folders: [], running: [] });
  const [eventsLog, setEventsLog] = useState([]);
  const [browserMissing, setBrowserMissing] = useState(false);
  const [browserInfo, setBrowserInfo] = useState(null);
  const [proxyOffer, setProxyOffer] = useState(null);
  useEffect(() => { api('/api/profiles/proxy-launch-offer').then(setProxyOffer).catch(() => {}); }, []);
  const answerProxyOffer = async action => {
    try {
      const r = await api('/api/profiles/proxy-launch-offer', { method: 'POST', body: { action } });
      setProxyOffer({ controlled: 0, offered: false });
      if (action === 'switch') toast(`Switched ${r.switched} proxy ${r.switched === 1 ? 'profile' : 'profiles'} to Manual. A running profile changes on its next launch.`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  const names = useRef({});
  const reloadMeta = useCallback(() => api('/api/meta').then(setMeta).catch(() => {}), []);
  useEffect(() => {
    reloadMeta(); api('/api/browser').then(b => { setBrowserInfo(b); setBrowserMissing(!b.installed); }).catch(() => {});
    const t = setInterval(reloadMeta, 5000);
    const off = subscribe(async e => {
      if (refreshesNow(e)) reloadMeta(); // refresh rows now; don't wait on the name lookup
      if (e.id && !names.current[e.id]) { try { names.current[e.id] = (await api(`/api/profiles/${e.id}`)).name; } catch {} }
      e.name = names.current[e.id];
      setEventsLog(l => [...l.slice(-50), e]);
      if (e.type === 'profile:crashed') toast(`${e.name || 'A profile'}: ${crashSummary(e.error)}`, 'error', `${e.type}|${e.id}|${e.at}`);
      if (e.type === 'browser:install' && e.state === 'done') { toast('Chromium installed', 'success'); setBrowserMissing(false); }
      if (e.type === 'browser:install' && e.state === 'failed') toast('Chromium download failed: ' + e.error, 'error');
      if (!refreshesNow(e)) reloadMeta();
    });
    const missing = () => setBrowserMissing(true); addEventListener('pm:chromium-missing', missing);
    return () => { clearInterval(t); off(); removeEventListener('pm:chromium-missing', missing); };
  }, [reloadMeta, toast]);
  const named = meta.folders.filter(Boolean).filter(name => name.toLowerCase().includes(folderQuery.trim().toLowerCase()));
  const count = folder => meta.folderCounts?.[folder] ?? '';
  const showProfiles = (folderName, nextScope = 'all') => { setScope(nextScope); openFolder(folderName); };
  return <div className={'app shell' + (compact ? ' compact' : '')}>
    {folderDialog && <ProfileFolderDialog from={folderDialog.from} onClose={() => setFolderDialog(null)}
      onSaved={path => { setFolderDialog(null); showProfiles(path); reloadMeta(); }} />}
    <header className="topbar">
      <div className="brand"><span className="logo"><img src="/azwah.svg" alt="" width="22" height="22" /></span><span>AZWAH</span></div>
      <button type="button" className={'top-live' + (meta.running.length ? ' on' : '')} onClick={() => showProfiles('__all', 'running')}
        aria-label={`${meta.running.length} running ${meta.running.length === 1 ? 'profile' : 'profiles'}. Show running profiles`}>
        <span className="live-dot" aria-hidden="true" />{meta.running.length ? `${meta.running.length} running` : 'Nothing running'}
      </button>
      <button className="top-updates" type="button" onClick={openUpdates}>Updates{update?.status === 'available' && <span className="update-dot" aria-label="New version available" />}</button>
      <div className="top-meta">
        <span className="edition-pill">{edition?.edition === 'owner-personal' ? 'Owner' : edition?.active ? 'Office' : edition?.enforced ? 'Office · not activated' : 'Local'}</span>
        <div className="seg sm" role="radiogroup" aria-label="Theme">{[['light', 'Light theme', 'sun'], ['system', 'System theme', 'diagnostics'], ['dark', 'Dark theme', 'moon']].map(([k, label, ic]) =>
          <button key={k} role="radio" aria-checked={theme === k} aria-label={label} title={label} className={theme === k ? 'sel' : ''} onClick={() => setTheme(k)}>{k === 'system' ? 'Auto' : <Icon name={ic} />}</button>)}</div>
      </div>
    </header>
    <div className="shell-body">
      <aside className="side" aria-label="Navigation sidebar">
        <div className="side-section">Workspace</div>
      <nav className="side-primary" aria-label="Workspace tools">
        {NAV.map(([k, label]) => <button key={k} data-nav={k} className={'nav' + (page === k ? ' sel' : '')} aria-current={page === k ? 'page' : undefined} title={label} onClick={() => { setPage(k); if (k === 'profiles') { setScope('all'); setFolder('__all'); } }}>
          <Icon name={k === 'cookie-robot' ? 'bolt' : k} /><span>{label}</span>
        </button>)}
      </nav>
        <div className="side-section">Manage</div>
        <button data-nav="trash" className={'nav' + (page === 'trash' ? ' sel' : '')} onClick={() => setPage('trash')}><Icon name="trash" />Trash <span className="count">{meta.trashCount ?? 0}</span></button>
        <button data-nav="backup" className={'nav' + (page === 'settings' ? ' sel' : '')} onClick={() => { setPage('settings'); setBackupRequest(value => value + 1); }}><Icon name="download" />Backup</button>
        {MORE.map(([k, label]) => <button key={k} data-nav={k} className={'nav' + (page === k ? ' sel' : '')} onClick={() => setPage(k)}><Icon name={k} />{label}</button>)}
        <details className="profile-scopes">
          <summary>Profile collections</summary>
        <button className={'nav' + (page === 'profiles' && scope === 'all' && folder === '__all' ? ' sel' : '')} onClick={() => { setScope('all'); showProfiles('__all'); }}><Icon name="profiles" />All profiles <span className="count">{meta.profileCount ?? ''}</span></button>
        <button className={'nav' + (page === 'profiles' && scope === 'running' ? ' sel' : '')} onClick={() => showProfiles('__all', 'running')}><Icon name="play" />Running profiles <span className="count">{meta.running.length}</span></button>
        <button className={'nav' + (page === 'profiles' && scope === 'favorites' ? ' sel' : '')} onClick={() => showProfiles('__all', 'favorites')}><Icon name="star" />Favorites <span className="count">{meta.favoriteCount ?? ''}</span></button>
        <div className="folder-tools">
          <input aria-label="Search folders" placeholder="Search folders" value={folderQuery} onChange={e => setFolderQuery(e.target.value)} />
          <button type="button" className="icon-btn" aria-label="Create folder" onClick={() => setFolderDialog({})}>+</button>
          {page === 'profiles' && scope === 'all' && folder && folder !== '__all' &&
            <button type="button" className="icon-btn" aria-label="Manage selected folder" onClick={() => setFolderDialog({ from: folder })}><Icon name="edit" /></button>}
        </div>
        <div className="side-section">Folders</div>
        <div className="folders">
          {named.map(f => <button key={f} className={'nav sub' + (page === 'profiles' && folder === f ? ' sel' : '')} onClick={() => { setScope('all'); showProfiles(f); }}><Icon name="folder" /><span className="folder-name" title={f}>{f}</span><span className="count">{count(f)}</span></button>)}
          {meta.folders.includes('') && !folderQuery && <button className={'nav sub' + (page === 'profiles' && folder === '' ? ' sel' : '')} onClick={() => { setScope('all'); showProfiles(''); }}><Icon name="folder" /><span className="folder-name">No folder</span><span className="count">{count('')}</span></button>}
          {!named.length && <div className="side-empty">{folderQuery.trim() ? 'No matching folders.' : 'Create a folder to organize profiles.'}</div>}
        </div>
        </details>
        <div className="side-foot">
          <button className="ghost" onClick={() => setCompact(value => !value)}>{compact ? 'Comfortable rows' : 'Compact rows'}</button>
        </div>
      </aside>
      <main className="content" data-shot={page}>
        {page === 'profiles' && <div className="profile-heading">
          <div><h1>Profiles</h1><p>Manage isolated browser sessions and their network settings.</p></div>
          <FleetBar total={meta.profileCount ?? 0} running={meta.running.length} errors={meta.errorCount ?? 0} proxyFailed={meta.proxyFailedCount ?? 0}
            onShow={nextScope => showProfiles('__all', nextScope)} />
        </div>}
        {update?.status === 'available' && update.latest.version !== remindedVersion && <div className="notice" role="status">
          AZWAH update {update.latest.version} is available.{' '}
          <button onClick={openUpdates}>View update</button>{' '}
          <button onClick={() => setRemindedVersion(update.latest.version)}>Remind me later</button>
        </div>}
        {page === 'profiles' && browserInfo?.runtime === 'stable-chrome' && proxyOffer?.offered && <div className="notice proxy-offer" role="status">
          <span>{proxyOffer.controlled} proxy {proxyOffer.controlled === 1 ? 'profile launches' : 'profiles launch'} <strong>Controlled</strong>: sites can see the automation connection (BrowserScan shows WebDriver as Robot). <strong>Manual</strong> opens plain Chrome through the same proxy; the page then shows this PC's timezone.</span>
          <span className="proxy-offer-actions"><button className="primary" onClick={() => answerProxyOffer('switch')}>Switch to Manual</button><button onClick={() => answerProxyOffer('keep')}>Keep Controlled</button></span>
        </div>}
        {browserMissing && page !== 'diagnostics' && (browserInfo?.runtime === 'stable-chrome'
          ? <div className="notice warn" role="status">Google Chrome isn't installed on this PC, so profiles can't launch. AZWAH opens profiles in your installed Chrome; it does not include a browser. Install Chrome, then reopen AZWAH. <a className="primary btn-link" href={browserInfo.downloadUrl} target="_blank" rel="noreferrer">Get Google Chrome</a></div>
          : <div className="notice warn">Chromium isn't installed yet, so profiles can't launch. <button className="primary" onClick={() => setPage('diagnostics')}>Download Chromium</button></div>)}
        {page === 'dashboard' && <DashboardPage onOpenProfiles={() => showProfiles('__all')} />}
        {page === 'profiles' && <ProfilesPage meta={meta} reloadMeta={reloadMeta} folder={folder} setFolder={showProfiles} workspaceFilter={workspaceFilter} onWorkspaceFilterChange={setWorkspaceFilter} scope={scope} browser={browserInfo} goto={setPage} />}
        {page === 'trash' && <TrashPage />}
        {page === 'templates' && <TemplatesPage reloadMeta={reloadMeta} />}
        {page === 'workspaces' && <WorkspacesPage onOpenProfiles={openWorkspaceProfiles} />}
        {page === 'cookie-robot' && <CookieRobotPage />}
        {page === 'proxies' && <ProxiesPage />}
        {page === 'extensions' && <ExtensionsPage />}
        {page === 'monitoring' && <MonitoringPage />}
        {page === 'activation' && <OfficeActivation />}
        {SHOW_ADMIN && page === 'license-admin' && <LicenseAdminPage />}
        {page === 'settings' && <SettingsPage backupRequest={backupRequest} updateRequest={updateRequest} />}
        {page === 'diagnostics' && <DiagnosticsPage eventsLog={eventsLog} />}
      </main>
    </div>
  </div>;
}
