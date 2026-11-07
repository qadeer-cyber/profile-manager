import { OfficeActivation } from './components/OfficeActivation.jsx';
import React, { useEffect, useState, useCallback, useRef, createContext, useContext } from 'react';
import { api, subscribe } from './api.js';
import { useToast } from './components/Toasts.jsx';
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
  const [edition, setEdition] = useState(null);
  const [scope, setScope] = useState('all');
  const [folderQuery, setFolderQuery] = useState('');
  const [folderDraft, setFolderDraft] = useState('');
  const [pendingCreate, setPendingCreate] = useState(null);
  useEffect(()=>{api('/api/activation').then(state=>{setEdition(state);if(state.edition==='ultimate')document.title='Azwah Multi Browser Ultimate';if(state.edition==='owner-personal')document.title='Azwah Multi Browser Owner';if(state.enforced&&!state.active)setPage('activation');}).catch(()=>{});},[]);
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
      if (event.key === '/' && page === 'profiles') { event.preventDefault(); document.querySelector('.search input')?.focus(); return; }
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
  const openWorkspaceProfiles = id => { setWorkspaceFilter(id); setFolder('__all'); setPage('profiles'); };
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
  const showProfiles = folderName => { setScope('all'); openFolder(folderName); };
  return <div className={'app shell' + (compact ? ' compact' : '')}>
    <header className="topbar">
      <div className="brand"><span className="logo"><img src="/azwah.svg" alt="" width="22" height="22" /></span><span>Azwah</span></div>
      <nav className="topnav" aria-label="Main">
        {NAV.map(([k, label]) => <button key={k} data-nav={k} className={'nav' + (page === k ? ' sel' : '')} aria-current={page === k ? 'page' : undefined} title={label} onClick={() => { setPage(k); if (k === 'profiles') { setScope('all'); setFolder('__all'); } }}>
          <Icon name={k === 'cookie-robot' ? 'bolt' : k} />{label}
        </button>)}
      </nav>
      <div className="top-meta">
        <span className="edition-pill">{edition?.edition === 'owner-personal' ? 'Owner' : edition?.active ? 'Office' : edition?.enforced ? 'Office · not activated' : 'Local'}</span>
        <div className="seg sm" role="radiogroup" aria-label="Theme">{[['light', 'Light theme', 'sun'], ['system', 'System theme', 'diagnostics'], ['dark', 'Dark theme', 'moon']].map(([k, label, ic]) =>
          <button key={k} role="radio" aria-checked={theme === k} aria-label={label} title={label} className={theme === k ? 'sel' : ''} onClick={() => setTheme(k)}>{k === 'system' ? 'Auto' : <Icon name={ic} />}</button>)}</div>
      </div>
    </header>
    <div className="shell-body">
      <nav className="side" aria-label="Profiles">
        <button className={'nav' + (page === 'profiles' && scope === 'all' && folder === '__all' ? ' sel' : '')} onClick={() => { setScope('all'); showProfiles('__all'); }}><Icon name="profiles" />All profiles <span className="count">{meta.profileCount ?? ''}</span></button>
        <button className={'nav' + (page === 'profiles' && scope === 'running' ? ' sel' : '')} onClick={() => { setScope('running'); setFolder('__all'); setPage('profiles'); }}><Icon name="play" />Running profiles <span className="count">{meta.running.length}</span></button>
        <button className="nav" disabled title="Favorites are not stored in this build"><Icon name="star" />Favorites <span className="count">Unavailable</span></button>
        <div className="folder-tools">
          <input aria-label="Search folders" placeholder="Search folders" value={folderQuery} onChange={e => setFolderQuery(e.target.value)} />
          <button type="button" className="icon-btn" aria-label="Create folder" title="Folders are saved when a profile uses the name. Nested folders are not stored." onClick={() => { const name = folderDraft.trim(); if (!name) return; setFolderDraft(''); setPendingCreate(name); showProfiles(name); }}>+</button>
        </div>
        <input aria-label="New folder name" placeholder="New folder name" value={folderDraft} onChange={e => setFolderDraft(e.target.value)} />
        <div className="side-section">Folders</div>
        <div className="folders">
          {named.map(f => <button key={f} className={'nav sub' + (page === 'profiles' && folder === f ? ' sel' : '')} onClick={() => { setScope('all'); showProfiles(f); }}><Icon name="folder" /><span className="folder-name">{f}</span><span className="count">{count(f)}</span></button>)}
          {meta.folders.includes('') && !folderQuery && <button className={'nav sub' + (page === 'profiles' && folder === '' ? ' sel' : '')} onClick={() => { setScope('all'); showProfiles(''); }}><Icon name="folder" /><span className="folder-name">No folder</span><span className="count">{count('')}</span></button>}
          {!named.length && <div className="side-empty">{folderQuery.trim() ? 'No matching folders.' : 'Folders appear after a profile is saved with a name.'}</div>}
        </div>
        <button data-nav="trash" className={'nav' + (page === 'trash' ? ' sel' : '')} onClick={() => setPage('trash')}><Icon name="trash" />Trash <span className="count">{meta.trashCount ?? 0}</span></button>
        <button data-nav="backup" className={'nav' + (page === 'settings' ? ' sel' : '')} onClick={() => setPage('settings')}><Icon name="download" />Backup</button>
        {MORE.map(([k, label]) => <button key={k} data-nav={k} className={'nav' + (page === k ? ' sel' : '')} onClick={() => setPage(k)}><Icon name={k} />{label}</button>)}
        <div className="side-foot">
          <p className="side-note">Team accounts, subscriptions, and cloud profile storage are not part of this local build.</p>
          <button className="ghost" onClick={() => setCompact(value => !value)}>{compact ? 'Comfortable rows' : 'Compact rows'}</button>
        </div>
      </nav>
      <main className="content" data-shot={page}>
        {browserMissing && page !== 'diagnostics' && <div className="notice warn">Chromium isn't installed yet, so profiles can't launch. <button className="primary" onClick={() => setPage('diagnostics')}>Download Chromium</button></div>}
        {page === 'dashboard' && <DashboardPage onOpenProfiles={() => showProfiles('__all')} />}
        {page === 'profiles' && <ProfilesPage meta={meta} reloadMeta={reloadMeta} folder={folder} setFolder={name => { setScope('all'); openFolder(name); }} workspaceFilter={workspaceFilter} onWorkspaceFilterChange={setWorkspaceFilter} scope={scope} pendingCreate={pendingCreate} onPendingCreateHandled={() => setPendingCreate(null)} />}
        {page === 'trash' && <TrashPage />}
        {page === 'templates' && <TemplatesPage reloadMeta={reloadMeta} />}
        {page === 'workspaces' && <WorkspacesPage onOpenProfiles={openWorkspaceProfiles} />}
        {page === 'cookie-robot' && <CookieRobotPage />}
        {page === 'proxies' && <ProxiesPage />}
        {page === 'extensions' && <ExtensionsPage />}
        {page === 'monitoring' && <MonitoringPage />}
        {page === 'activation' && <OfficeActivation />}
        {SHOW_ADMIN && page === 'license-admin' && <LicenseAdminPage />}
        {page === 'settings' && <SettingsPage />}
        {page === 'diagnostics' && <DiagnosticsPage eventsLog={eventsLog} />}
      </main>
    </div>
  </div>;
}
