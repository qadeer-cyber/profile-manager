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

const SHOW_ADMIN = import.meta.env.VITE_AZWAH_ADMIN === '1';
const NAV = [['profiles', 'Profiles'], ['proxies', 'Proxies'], ['extensions', 'Extensions'], ['workspaces', 'Workspaces'], ['cookie-robot', 'Automation'], ...(SHOW_ADMIN ? [['license-admin', 'License admin']] : []), ['diagnostics', 'Help and diagnostics'], ['settings', 'Settings']];
const MORE = [['dashboard', 'Dashboard'], ['templates', 'Templates'], ['monitoring', 'Monitoring'], ['activation', 'Edition']];
export function App() {
  const toast = useToast();
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
      const target = event.target;
      if (target && (target.closest('input, textarea, select') || target.isContentEditable)) return;
      if (event.key === '/') { event.preventDefault(); document.querySelector(page === 'profiles' ? '.search input' : '.command-search input')?.focus(); return; }
      if (event.key === 'n' && page === 'profiles') { event.preventDefault(); document.querySelector('[data-action=new-profile]')?.click(); return; }
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
  const names = useRef({});
  const reloadMeta = useCallback(() => api('/api/meta').then(setMeta).catch(() => {}), []);
  useEffect(() => {
    reloadMeta(); api('/api/browser').then(b => setBrowserMissing(!b.installed)).catch(() => {});
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
      <form className="command-search" role="search" onSubmit={event => { event.preventDefault(); const query = new FormData(event.currentTarget).get('destination').trim().toLowerCase(); const match = query && [...NAV, ...MORE, ['trash', 'Trash']].find(([,label]) => label.toLowerCase().includes(query)); if (match) { setPage(match[0]); event.currentTarget.reset(); } }}>
        <Icon name="search" /><input name="destination" aria-label="Find a page" placeholder="Find a page…" list="azwah-destinations" />
        <datalist id="azwah-destinations">{[...NAV, ...MORE, ['trash', 'Trash']].map(([key,label]) => <option key={key} value={label} />)}</datalist>
      </form>
      {page === 'profiles' && <button className="primary top-create" onClick={() => document.querySelector('[data-action=new-profile]')?.click()}>＋ New profile</button>}
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
        <details className="profile-scopes" open={page === 'profiles'}>
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
        <div className="side-section">Manage</div>
        <button data-nav="trash" className={'nav' + (page === 'trash' ? ' sel' : '')} onClick={() => setPage('trash')}><Icon name="trash" />Trash <span className="count">{meta.trashCount ?? 0}</span></button>
        <button data-nav="backup" className={'nav' + (page === 'settings' ? ' sel' : '')} onClick={() => { setPage('settings'); setBackupRequest(value => value + 1); }}><Icon name="download" />Backup</button>
        {MORE.map(([k, label]) => <button key={k} data-nav={k} className={'nav' + (page === k ? ' sel' : '')} onClick={() => setPage(k)}><Icon name={k} />{label}</button>)}
        <div className="side-foot">
          <button className="ghost" onClick={() => setCompact(value => !value)}>{compact ? 'Comfortable rows' : 'Compact rows'}</button>
        </div>
      </aside>
      <main className="content" data-shot={page}>
        {page === 'profiles' && <div className="profile-heading">
          <div><h1>Profiles</h1><p>Manage isolated browser sessions and their network settings.</p></div>
          <div className="profile-metrics" aria-label="Profile summary">
            <div><strong>{meta.profileCount ?? '—'}</strong><span>Profiles</span></div>
            <div><strong>{meta.running.length}</strong><span><i /> Running</span></div>
          </div>
        </div>}
        {browserMissing && page !== 'diagnostics' && <div className="notice warn">Chromium isn't installed yet, so profiles can't launch. <button className="primary" onClick={() => setPage('diagnostics')}>Download Chromium</button></div>}
        {page === 'dashboard' && <DashboardPage onOpenProfiles={() => showProfiles('__all')} />}
        {page === 'profiles' && <ProfilesPage meta={meta} reloadMeta={reloadMeta} folder={folder} setFolder={showProfiles} workspaceFilter={workspaceFilter} onWorkspaceFilterChange={setWorkspaceFilter} scope={scope} />}
        {page === 'trash' && <TrashPage />}
        {page === 'templates' && <TemplatesPage reloadMeta={reloadMeta} />}
        {page === 'workspaces' && <WorkspacesPage onOpenProfiles={openWorkspaceProfiles} />}
        {page === 'cookie-robot' && <CookieRobotPage />}
        {page === 'proxies' && <ProxiesPage />}
        {page === 'extensions' && <ExtensionsPage />}
        {page === 'monitoring' && <MonitoringPage />}
        {page === 'activation' && <OfficeActivation />}
        {SHOW_ADMIN && page === 'license-admin' && <LicenseAdminPage />}
        {page === 'settings' && <SettingsPage backupRequest={backupRequest} />}
        {page === 'diagnostics' && <DiagnosticsPage eventsLog={eventsLog} />}
      </main>
    </div>
  </div>;
}
