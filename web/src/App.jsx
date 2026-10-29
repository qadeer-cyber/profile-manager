import React, { useEffect, useState, useCallback, useRef, createContext, useContext } from 'react';
import { api, subscribe } from './api.js';
import { useToast } from './components/Toasts.jsx';
import { ProfilesPage } from './pages/ProfilesPage.jsx';
import { ProxiesPage } from './pages/ProxiesPage.jsx';
import { ExtensionsPage } from './pages/ExtensionsPage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';
import { DiagnosticsPage } from './pages/DiagnosticsPage.jsx';
import { TrashPage } from './pages/TrashPage.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { MonitoringPage } from './pages/MonitoringPage.jsx';
import { Icon } from './components/Icon.jsx';
import { useTheme } from './hooks/useTheme.js';
import { crashSummary, refreshesNow } from './lib.js';

const NAV = [['dashboard', 'Dashboard'], ['profiles', 'Profiles'], ['trash', 'Trash'], ['proxies', 'Proxies'], ['extensions', 'Extensions'], ['monitoring', 'Monitoring'], ['settings', 'Settings'], ['diagnostics', 'Diagnostics']];
export function App() {
  const toast = useToast();
  const [page, setPage] = useState('profiles');
  const [folder, setFolder] = useState('__all');
  const [theme, setTheme] = useTheme();
  const [compact, setCompact] = useState(() => localStorage.getItem('pm-density') === 'compact');
  useEffect(() => { localStorage.setItem('pm-density', compact ? 'compact' : 'comfortable'); }, [compact]);
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
  const openFolder = f => { setFolder(f); setPage('profiles'); };
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
  const named = meta.folders.filter(Boolean);
  return <div className={'app' + (compact ? ' compact' : '')}>
    <nav className="side" aria-label="Main">
      <div className="brand"><span className="logo"><Icon name="profiles" size={18} /></span>Profile Manager</div>
      {NAV.map(([k, label]) => <button key={k} data-nav={k} className={'nav' + (page === k ? ' sel' : '')} aria-current={page === k ? 'page' : undefined} onClick={() => { setPage(k); if (k === 'profiles') setFolder('__all'); }}>
        <Icon name={k} />{label}{k === 'profiles' && meta.running.length > 0 && <span className="badge" title="Running">{meta.running.length}</span>}</button>)}
      <div className="side-section">Folders</div>
      <div className="folders">
        {named.map(f => <button key={f} className={'nav sub' + (page === 'profiles' && folder === f ? ' sel' : '')} onClick={() => openFolder(f)}><Icon name="folder" />{f}</button>)}
        {meta.folders.includes('') && <button className={'nav sub' + (page === 'profiles' && folder === '' ? ' sel' : '')} onClick={() => openFolder('')}><Icon name="folder" /><span className="muted-inline">No folder</span></button>}
        {!meta.folders.length && <div className="side-empty">Folders appear when you assign one to a profile.</div>}
      </div>
      <div className="side-foot">
        <div className="seg sm" role="radiogroup" aria-label="Theme">{[['light', 'sun'], ['system', 'diagnostics'], ['dark', 'moon']].map(([k, ic]) =>
          <button key={k} role="radio" aria-checked={theme === k} title={k[0].toUpperCase() + k.slice(1) + ' theme'} className={theme === k ? 'sel' : ''} onClick={() => setTheme(k)}>{k === 'system' ? 'Auto' : <Icon name={ic} />}</button>)}</div>
        <button className="ghost" onClick={() => setCompact(value => !value)}>{compact ? 'Comfortable' : 'Compact'}</button>
        <span>{window.pm?.desktop ? 'Desktop app' : 'Web mode'} · g then d/p/x/m/s/i</span>
      </div>
    </nav>
    <main className="content">
      {browserMissing && page !== 'diagnostics' && <div className="notice warn">Chromium isn't installed yet, so profiles can't launch. <button className="primary" onClick={() => setPage('diagnostics')}>Download Chromium</button></div>}
      {page === 'dashboard' && <DashboardPage onOpenProfiles={() => openFolder('__all')} />}
      {page === 'profiles' && <ProfilesPage meta={meta} reloadMeta={reloadMeta} folder={folder} setFolder={openFolder} />}
      {page === 'trash' && <TrashPage />}
      {page === 'proxies' && <ProxiesPage />}
      {page === 'extensions' && <ExtensionsPage />}
      {page === 'monitoring' && <MonitoringPage />}
      {page === 'settings' && <SettingsPage />}
      {page === 'diagnostics' && <DiagnosticsPage eventsLog={eventsLog} />}
    </main>
  </div>;
}
