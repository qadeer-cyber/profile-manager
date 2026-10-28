import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

export function DashboardPage({ onOpenProfiles }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    api('/api/dashboard').then(data => { setStats(data); setError(''); }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); const timer = setInterval(load, 5000); return () => clearInterval(timer); }, [load]);
  return <>
    <header className="page-head"><div><h1>Dashboard</h1><div className="muted">{stats ? `Updated ${new Date(stats.generatedAt).toLocaleTimeString()}` : 'Loading live counts'}</div></div>
      <button onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button></header>
    {error && <div className="notice warn" role="alert">{error} <button onClick={load}>Retry</button></div>}
    {!stats && !error && <p className="muted">Loading profile, proxy, and session counts…</p>}
    {stats && <>
      <div className="stat-grid">
        <Stat label="Profiles" value={stats.profiles.total} detail={`${stats.profiles.stopped} stopped`} />
        <Stat label="Running" value={stats.profiles.running} detail={`${stats.sessions.length} live session${stats.sessions.length === 1 ? '' : 's'}`} />
        <Stat label="Errors" value={stats.profiles.withError} detail="profiles with a last error" />
        <Stat label="Automation" value={stats.profiles.automationEnabled} detail="profiles with CDP enabled" />
        <Stat label="Proxies" value={stats.proxies.total} detail={`${stats.proxies.ok} ok · ${stats.proxies.failed} failed · ${stats.proxies.untested} untested`} />
        <Stat label="Extensions" value={stats.extensions} detail={`${stats.proxies.assigned} proxies assigned`} />
      </div>
      <div className="cols">
        <section className="panel"><h2>Live sessions</h2>
          {!stats.sessions.length && <p className="muted">No profile is running in this process.</p>}
          {!!stats.sessions.length && <table className="grid"><thead><tr><th>Profile</th><th>PID</th><th>Started</th><th>CDP</th></tr></thead><tbody>
            {stats.sessions.map(session => <tr key={session.id}><td>{session.name || session.id}</td><td className="mono-sm">{session.pid ?? '—'}</td><td className="muted">{session.startedAt ? new Date(session.startedAt).toLocaleString() : '—'}</td><td>{session.automation ? 'On' : 'Off'}</td></tr>)}
          </tbody></table>}
        </section>
        <section className="panel"><h2>Recent profile errors</h2>
          {!stats.errors.length && <p className="muted">No profile has a stored last error.</p>}
          {!!stats.errors.length && <ul className="error-list">{stats.errors.map(item => <li key={item.id}><button className="link" onClick={() => onOpenProfiles(item.name)}>{item.name}</button><div className="err-text small">{item.message}</div></li>)}</ul>}
        </section>
      </div>
    </>}
  </>;
}
function Stat({ label, value, detail }) {
  return <section className="stat"><span className="muted">{label}</span><b>{value}</b><span className="muted">{detail}</span></section>;
}
