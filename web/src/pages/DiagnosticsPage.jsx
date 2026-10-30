import { RecoveryPanel } from '../components/RecoveryPanel.jsx';
import React, { useEffect, useState, useCallback, useRef, createContext, useContext } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toasts.jsx';
import { ProfileDiagnostics } from '../components/ProfileDiagnostics.jsx';

export function DiagnosticsPage({ eventsLog }) {
  const toast = useToast();
  const [d, setD] = useState(null), [b, setB] = useState(null), [upd, setUpd] = useState(null), [backups, setBackups] = useState(null);
  const load = useCallback(() => {
    api('/api/diagnostics').then(setD);
    api('/api/browser').then(setB);
    api('/api/browser-engine/update-manager').then(setUpd).catch(() => {});
    api('/api/browser/backups').then(setBackups).catch(() => {});
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 2000); return () => clearInterval(t); }, [load]);
  if (!d || !b) return null;
  const install = async () => { try { await api('/api/browser/install', { method: 'POST' }); toast('Downloading Chromium…'); load(); } catch (e) { toast(e.message, 'error'); } };
  const exportGoogleCompat = async () => {
    try {
      const report = await api('/api/google-compat/report', { method: 'POST', body: JSON.stringify({ probe: true }) });
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `profile-manager-google-compat-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Google compatibility report downloaded (local only).');
    } catch (e) { toast(e.message, 'error'); }
  };
  const Row = ({ k, v }) => <tr><th>{k}</th><td>{v}</td></tr>;
  return <>
    <header className="page-head"><h1>Diagnostics</h1>
      <button type="button" onClick={exportGoogleCompat} aria-label="Export Google compatibility diagnostic">Export Google compatibility (local JSON)</button>
      <button onClick={load} aria-label="Refresh app information">Refresh</button></header>
    <section className="panel"><p className="muted small">The Google compatibility export is saved on this PC only. It does not solve CAPTCHAs, does not send data to Profile Manager servers, and redacts proxy passwords. Use it to compare launch shape, DNS, and reCAPTCHA script reachability with ordinary Chrome.</p></section>
    <RecoveryPanel />
    <ProfileDiagnostics />
    <div className="cols">
      <section className="panel"><h2>App</h2><table className="kv"><tbody>
        <Row k="Version" v={`${d.app.version} (${d.app.mode})`} /><Row k="Platform" v={d.platform} />
        <Row k="Node / Electron / Chrome" v={`${d.versions.node} / ${d.versions.electron || '—'} / ${d.versions.chrome || '—'}`} />
        <Row k="Data folder" v={<code>{d.dataDir}</code>} /><Row k="Schema version" v={d.schemaVersion} />
        <Row k="Profiles / running" v={`${d.profiles} / ${d.running}`} /><Row k="Secret storage" v={<>{d.encryption.backend}{d.encryption.warning && <div className="err-text small">{d.encryption.warning}</div>}</>} />
        <Row k="API base" v={<code>{location.origin}/api/v1</code>} />
      </tbody></table></section>
      <section className="panel"><h2>Browser engine</h2><table className="kv"><tbody>
        <Row k="Status" v={b.installed ? <span className="ok-text">Installed</span> : <span className="err-text">Not installed</span>} />
        <Row k="Executable" v={<code className="small">{b.path}</code>} /><Row k="Download folder" v={<code className="small">{b.browsersPath}</code>} />
        <Row k="Installer" v={b.install.state + (b.install.error ? ` — ${b.install.error}` : '')} />
      </tbody></table>
        {!b.installed && !b.custom && <button className="primary" disabled={b.install.state === 'running'} onClick={install}>{b.install.state === 'running' ? 'Downloading…' : 'Download Chromium'}</button>}
        {b.install.log && <pre className="log">{b.install.log.slice(-1200)}</pre>}
        {upd?.rollback?.supported && <>
          <h3 className="muted">CfT rollback slots</h3>
          <p className="muted small">Reinstall moves the current tree to a timestamped backup. Roll back swaps the active slot with the latest backup.</p>
          {upd.slots?.map(slot => <div key={slot.name} className="muted small">{slot.name}: {slot.active?.present ? 'installed' : 'missing'} · backups {slot.backups?.length || 0}</div>)}
          {upd.rollback.available && backups && <div className="row" style={{ marginTop: 8 }}>
            <button disabled={!backups.chromium?.length} onClick={async () => { try { await api('/api/browser/rollback', { method: 'POST', body: { name: 'chromium' } }); toast('Chromium rolled back', 'success'); load(); } catch (e) { toast(e.message, 'error'); } }}>Rollback Chromium</button>
            <button disabled={!backups['chromium-headless-shell']?.length} onClick={async () => { try { await api('/api/browser/rollback', { method: 'POST', body: { name: 'chromium-headless-shell' } }); toast('Headless shell rolled back', 'success'); load(); } catch (e) { toast(e.message, 'error'); } }}>Rollback headless shell</button>
          </div>}
        </>}
      </section>
    </div>
    <section className="panel"><h2>Recent events</h2>
      {eventsLog.length ? <table className="grid small"><tbody>{eventsLog.slice(-15).reverse().map((e, i) => <tr key={i}><td className="muted">{new Date(e.at || Date.now()).toLocaleTimeString()}</td><td>{e.type}</td><td>{e.name || e.id || ''}</td><td className="err-text">{e.error || ''}</td></tr>)}</tbody></table> : <p className="muted">No events yet this session.</p>}
    </section>
  </>;
}

