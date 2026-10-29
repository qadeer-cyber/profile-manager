import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toasts.jsx';

export function CookieRobotPage() {
  const toast = useToast();
  const [jobs, setJobs] = useState([]);
  const [profileId, setProfileId] = useState('');
  const [urls, setUrls] = useState('https://example.com\n');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setJobs(await api('/api/cookie-robot/jobs')); } catch (e) { toast(e.message, 'error'); }
  }, [toast]);
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [load]);
  const start = async () => {
    setBusy(true);
    try {
      const list = urls.split('\n').map(s => s.trim()).filter(Boolean);
      await api('/api/cookie-robot/jobs', { method: 'POST', body: { profileId: profileId.trim(), urls: list, delayMs: 1500 } });
      toast('Job queued', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return <>
    <header className="page-head"><h1>CookieRobot (local)</h1></header>
    <section className="panel"><p className="muted">User-authorized URL batches only. Uses Chromium automation (CDP). Does not bypass CAPTCHAs or abuse third-party sites.</p>
      <label>Profile ID<input value={profileId} onChange={e => setProfileId(e.target.value)} placeholder="UUID from Profiles" /></label>
      <label>URLs (one per line)<textarea rows={5} value={urls} onChange={e => setUrls(e.target.value)} /></label>
      <button className="primary" disabled={busy || !profileId.trim()} onClick={start}>Start job</button>
    </section>
    <div className="table-wrap"><table className="grid"><thead><tr><th>Status</th><th>Profile</th><th>Tasks</th><th></th></tr></thead><tbody>
      {jobs.map(j => <tr key={j.id}><td>{j.status}</td><td className="mono-sm">{j.profileId.slice(0, 8)}…</td>
        <td>{j.tasks.filter(t => t.status === 'ok').length}/{j.tasks.length} ok</td>
        <td className="actions">
          {j.status === 'running' && <button onClick={async () => { await api(`/api/cookie-robot/jobs/${j.id}/cancel`, { method: 'POST' }); load(); }}>Cancel</button>}
          {(j.status === 'failed' || j.status === 'cancelled') && <button onClick={async () => { await api(`/api/cookie-robot/jobs/${j.id}/retry`, { method: 'POST' }); load(); }}>Retry</button>}
        </td></tr>)}
    </tbody></table></div>
  </>;
}
