import React, { useEffect, useState, useCallback, useRef, createContext, useContext } from 'react';
import { api, subscribe } from './api.js';
import { useToast } from './components/Toasts.jsx';
import { ProfilesPage } from './pages/ProfilesPage.jsx';
import { ProxiesPage } from './pages/ProxiesPage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';
import { DiagnosticsPage } from './pages/DiagnosticsPage.jsx';
import { Icon } from './components/Icon.jsx';
import { useTheme } from './hooks/useTheme.js';

const NAV = [['profiles', 'Profiles'], ['proxies', 'Proxies'], ['settings', 'Settings'], ['diagnostics', 'Diagnostics']];
export function App() {
  const toast = useToast();
  const [page, setPage] = useState('profiles');
  const [folder, setFolder] = useState('__all');
  const [theme, setTheme] = useTheme();
  const openFolder = f => { setFolder(f); setPage('profiles'); };
  const [meta, setMeta] = useState({ tags: [], folders: [], running: [] });
  const [eventsLog, setEventsLog] = useState([]);
  const [browserMissing, setBrowserMissing] = useState(false);
  const names = useRef({});
  const seenToast = useRef(new Set());
  const [liveEvent, setLiveEvent] = useState(null);
  const reloadMeta = useCallback(() => api('/api/meta').then(setMeta).catch(() => {}), []);
  useEffect(() => {
    reloadMeta(); api('/api/browser').then(b => setBrowserMissing(!b.installed)).catch(() => {});
    const t = setInterval(reloadMeta, 5000);
    const off = subscribe(e => {
      if (e.type === 'profile:started' || e.type === 'profile:stopped' || e.type === 'profile:crashed') {
        setLiveEvent({ ...e, seq: Date.now() + Math.random() });
      }
      setEventsLog(l => [...l.slice(-50), { ...e, name: names.current[e.id] }]);
      if (e.type === 'profile:crashed') {
        const key = `${e.type}:${e.id}:${e.at}`;
        if (!seenToast.current.has(key)) {
          seenToast.current.add(key);
          toast(`${names.current[e.id] || 'A profile'} closed unexpectedly: ${e.error || 'the browser exited'}`, 'error');
        }
      }
      if (e.id && !names.current[e.id]) api(`/api/profiles/${e.id}`).then(p => { names.current[e.id] = p.name; }).catch(() => {});
      if (e.type === 'browser:install' && e.state === 'done') { toast('Chromium installed', 'success'); setBrowserMissing(false); }
      if (e.type === 'browser:install' && e.state === 'failed') toast('Chromium download failed: ' + e.error, 'error');
      reloadMeta();
    });
    const missing = () => setBrowserMissing(true); addEventListener('pm:chromium-missing', missing);
    return () => { clearInterval(t); off(); removeEventListener('pm:chromium-missing', missing); };
  }, [reloadMeta, toast]);
  const named = meta.folders.filter(Boolean);
  return <div className="app">
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
        <span>{window.pm?.desktop ? 'Desktop app' : 'Web mode'}</span>
      </div>
    </nav>
    <main className="content">
      {browserMissing && page !== 'diagnostics' && <div className="notice warn">Chromium isn't installed yet, so profiles can't launch. <button className="primary" onClick={() => setPage('diagnostics')}>Download Chromium</button></div>}
      {page === 'profiles' && <ProfilesPage meta={meta} reloadMeta={reloadMeta} folder={folder} setFolder={openFolder} liveEvent={liveEvent} />}
      {page === 'proxies' && <ProxiesPage />}
      {page === 'settings' && <SettingsPage />}
      {page === 'diagnostics' && <DiagnosticsPage eventsLog={eventsLog} />}
    </main>
  </div>;
}
