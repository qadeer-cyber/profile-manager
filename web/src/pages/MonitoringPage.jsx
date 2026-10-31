import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

export function MonitoringPage() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  const load = useCallback((manual = false) => {
    setLoading(true);
    const url = manual ? '/api/monitoring?refresh=1' : '/api/monitoring';
    api(url).then(data => { setReport(data); setError(''); }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load(false);
    if (!auto) return undefined;
    const timer = setInterval(() => load(false), 5000);
    return () => clearInterval(timer);
  }, [load, auto]);
  return <>
    <header className="page-head">
      <div><h1>Advanced monitoring</h1><div className="muted">Optional process and launch metrics. Profile screens stay uncluttered.</div></div>
      <div className="row">
        <label className="check"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Auto-refresh (5s)</label>
        <button onClick={() => load(true)} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh now'}</button>
      </div>
    </header>
    {error && <div className="notice warn" role="alert">{error}</div>}
    {!report && !error && <p className="muted" role="status">Loading observations…</p>}
    {report && <>
      {report.host.lowMemoryWarning && <div className="notice warn">Host free memory is about {report.host.freeMemGiB} GiB.</div>}
      {report.observationError && <div className="notice warn">Process sample: {report.observationError}</div>}
      <div className="stat-grid compact-stats">
        <MiniStat label="Running" value={report.totals.runningProfiles} detail={`${report.queue.activeLaunches} launching · ${report.queue.queuedLaunches} queued`} />
        <MiniStat label="Browser RAM" value={report.totals.totalBrowserMemoryMiB != null ? `${report.totals.totalBrowserMemoryMiB} MiB` : '—'} detail={`${report.totals.assignedProcesses} Chromium processes · ${report.observation}`} />
        <MiniStat label="Host free" value={`${report.host.freeMemGiB} GiB`} detail={`${report.host.totalMemGiB} GiB total`} />
        <MiniStat label="Host CPU" value={report.host.cpuPercent != null ? `${report.host.cpuPercent}%` : '—'} detail={report.host.loadAvg ? `load ${report.host.loadAvg.join(', ')}` : 'load n/a on Windows'} />
      </div>
      <section className="panel">
        <h2>Profiles</h2>
        {!report.profiles.length && <p className="muted">No profile is running in this app process.</p>}
        {!!report.profiles.length && <table className="grid"><thead><tr><th>Profile</th><th>Status</th><th>RAM</th><th>Processes</th><th>Last launch</th><th>Error</th></tr></thead><tbody>
          {report.profiles.map(row => <tr key={row.id}>
            <td>{row.name || row.id}</td>
            <td>{row.status}</td>
            <td className="mono-sm">{row.memoryMiB != null ? `${row.memoryMiB} MiB` : '—'}</td>
            <td className="mono-sm">{row.processCount || 0}</td>
            <td className="muted">{row.launchMetrics?.totalLaunchMs != null ? `${row.launchMetrics.totalLaunchMs} ms${row.launchMetrics.warmStart ? ' warm' : ' cold'}` : '—'}</td>
            <td className="err-text small">{row.lastError || '—'}</td>
          </tr>)}
        </tbody></table>}
      </section>
      {!!report.profiles.some(row => row.processes?.length) && <section className="panel">
        <h2>Chromium processes</h2>
        <table className="grid"><thead><tr><th>Profile</th><th>Role</th><th>PID</th><th>RAM (MiB)</th></tr></thead><tbody>
          {report.profiles.flatMap(row => (row.processes || []).map(proc => <tr key={`${row.id}-${proc.pid}`}>
            <td>{row.name || row.id}</td><td>{proc.role}</td><td className="mono-sm">{proc.pid}</td><td className="mono-sm">{proc.memoryMiB ?? '—'}</td>
          </tr>))}
        </tbody></table>
      </section>}
      <p className="muted small">Environment: {report.environment.platform} {report.environment.release} · {report.environment.cpuModel || 'CPU unknown'} · cache age {report.cacheAgeMs ?? '—'} ms</p>
    </>}
  </>;
}

function MiniStat({ label, value, detail }) {
  return <section className="stat"><span className="muted">{label}</span><b>{value}</b><span className="muted">{detail}</span></section>;
}
