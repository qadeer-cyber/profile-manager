import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toasts.jsx';
import { HumanInputPanel } from '../components/HumanInputPanel.jsx';

export function CookieRobotPage() {
  const toast = useToast();
  const [jobs, setJobs] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [report, setReport] = useState(null);
  const [profileId, setProfileId] = useState('');
  const [urls, setUrls] = useState('https://example.com\n');
  const [delayMs, setDelayMs] = useState(1500);
  const [expanded, setExpanded] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reportError, setReportError] = useState('');
  const load = useCallback(async () => {
    try {
      setJobs(await api('/api/cookie-robot/jobs'));
    } catch (e) { toast(e.message, 'error'); }
  }, [toast]);
  useEffect(() => {
    api('/api/cookie-robot').then(r => { setReport(r); setReportError(''); }).catch(e => setReportError(e.message));
    api('/api/profiles').then(list => {
      setProfiles(list);
      if (!profileId && list.length) {
        const chromium = list.find(p => (p.browserEngine || 'chromium') !== 'firefox');
        if (chromium) setProfileId(chromium.id);
      }
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [load]);
  const selected = profiles.find(p => p.id === profileId);
  const isFirefox = selected?.browserEngine === 'firefox';
  const start = async () => {
    if (isFirefox) return toast('CookieRobot supports Chromium profiles only', 'error');
    setBusy(true);
    try {
      const list = urls.split('\n').map(s => s.trim()).filter(Boolean);
      await api('/api/cookie-robot/jobs', { method: 'POST', body: { profileId: profileId.trim(), urls: list, delayMs: Number(delayMs) || 1500 } });
      toast('Job queued', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return <>
    <header className="page-head"><h1>CookieRobot (local)</h1></header>
    <section className="panel">
      {reportError && <p className="err-text" role="alert">{reportError}</p>}
      {!report && !reportError && <p className="muted" aria-busy="true">Loading CookieRobot capability…</p>}
      <p className="muted">{report?.note || 'User-authorized URL batches only.'} {report?.firefox?.supported === false && <span>Firefox: {report.firefox.reason}</span>}</p>
      <label>Profile
        <select value={profileId} onChange={e => setProfileId(e.target.value)} aria-label="Profile">
          <option value="">Select profile…</option>
          {profiles.map(p => <option key={p.id} value={p.id}>{p.name} ({p.browserEngine || 'chromium'}){p.running ? ' · running' : ''}</option>)}
        </select>
      </label>
      {isFirefox && <p className="err-text" role="alert">This profile uses Firefox. CookieRobot requires Chromium with automation (CDP).</p>}
      {selected?.running && !selected?.automationEnabled && <p className="notice warn">Profile is running without automation. Stop it before starting a job, or the job will fail with NO_CDP.</p>}
      <label>URLs (one per line)<textarea rows={5} value={urls} onChange={e => setUrls(e.target.value)} /></label>
      <label>Delay between URLs (ms, 500–10000)<input type="number" min={500} max={10000} value={delayMs} onChange={e => setDelayMs(Number(e.target.value))} /></label>
      <button className="primary" disabled={busy || !profileId.trim() || isFirefox} onClick={start}>Start job</button>
    </section>
    <HumanInputPanel profileId={profileId} profiles={profiles} toast={toast} />
    <div className="table-wrap"><table className="grid"><thead><tr><th>Status</th><th>Profile</th><th>Tasks</th><th>Error</th><th></th></tr></thead><tbody>
      {jobs.map(j => {
        const ok = j.tasks.filter(t => t.status === 'ok').length;
        const failed = j.tasks.filter(t => t.status === 'failed').length;
        return <React.Fragment key={j.id}>
          <tr>
            <td>{j.status}</td>
            <td className="mono-sm" title={j.profileId}>{profiles.find(p => p.id === j.profileId)?.name || j.profileId.slice(0, 8) + '…'}</td>
            <td>{ok}/{j.tasks.length} ok{failed ? ` · ${failed} failed` : ''}</td>
            <td className="err-text small clamp">{j.error || '—'}</td>
            <td className="actions">
              <button className="ghost" onClick={() => setExpanded(expanded === j.id ? null : j.id)}>{expanded === j.id ? 'Hide' : 'Details'}</button>
              {j.status === 'running' && <button onClick={async () => { await api(`/api/cookie-robot/jobs/${j.id}/cancel`, { method: 'POST' }); load(); }}>Cancel</button>}
              {(j.status === 'failed' || j.status === 'cancelled' || j.status === 'done') && failed > 0 && (
                <button onClick={async () => { await api(`/api/cookie-robot/jobs/${j.id}/retry`, { method: 'POST', body: { failedOnly: true } }); load(); }}>Retry failed</button>
              )}
              {(j.status === 'failed' || j.status === 'cancelled') && (
                <button onClick={async () => { await api(`/api/cookie-robot/jobs/${j.id}/retry`, { method: 'POST' }); load(); }}>Retry all</button>
              )}
            </td>
          </tr>
          {expanded === j.id && <tr><td colSpan={5}><ul className="import-results">{j.tasks.map((t, i) => <li key={i} className={t.status === 'failed' ? 'bad' : ''}><span className="mono-sm">{t.url}</span> — {t.status}{t.error ? `: ${t.error}` : ''}</li>)}</ul></td></tr>}
        </React.Fragment>;
      })}
    </tbody></table></div>
  </>;
}
