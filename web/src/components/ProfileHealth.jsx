import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { buildHealth, STATE_LABEL } from '../lib/profileHealth.js';
import '../health.css';

// What a website would see for this profile, grouped, with mismatches first. Read-only: it observes the running
// browser through the existing hardware report and never changes the profile.
export function ProfileHealth({ profile }) {
  const [byCategory, setByCategory] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setBusy(true); setError('');
    api(`/api/profiles/${profile.id}/hardware`)
      .then(report => setByCategory(report?.consistency?.byCategory || []))
      .catch(e => setError(e.message || 'Could not read the profile.'))
      .finally(() => setBusy(false));
  }, [profile.id]);
  useEffect(() => { load(); }, [load, profile.running]);
  const health = buildHealth({ profile, running: Boolean(profile.running), byCategory });
  return <section className="health" aria-label="Profile health" data-verdict={health.verdict}>
    <div className="health-head">
      <div><h4>Profile health</h4>
        <p className={'health-headline ' + health.verdict} role="status">{health.headline}</p></div>
      <button type="button" onClick={load} disabled={busy}>{busy ? 'Measuring…' : 'Measure again'}</button>
    </div>
    {error && <p className="err-text" role="alert">{error}</p>}
    {health.groups.map(g => <div className="health-group" key={g.id}>
      <h5>{g.label}</h5>
      {[...g.rows].sort((a, b) => (b.state === 'mismatch') - (a.state === 'mismatch')).map(r =>
        <div className="health-row" key={r.id} data-state={r.state}>
          <span className="health-label">{r.label}</span>
          <span className={'pill health-' + r.state}>{STATE_LABEL[r.state]}</span>
          <span className="health-note" title={r.summary}>{r.summary}</span>
        </div>)}
    </div>)}
    <p className="muted small health-foot">A match means a saved setting agreed with what the running browser reported. It does not make a profile undetectable.</p>
  </section>;
}
