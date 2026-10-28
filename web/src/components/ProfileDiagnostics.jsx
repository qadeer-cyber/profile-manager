import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useToast } from './Toasts.jsx';
import { statusOf, crashSummary } from '../lib.js';
import { useProfileDiagnostics, CONSENT } from '../hooks/useProfileDiagnostics.js';
import '../diagnostics.css';

// ---------- human-readable text for every contract enum ----------
export const REASON_TEXT = {
  not_running: 'The profile isn’t running. Launch it, then refresh the observation.',
  launching: 'The browser is still starting. Refresh once it’s running.',
  stopping: 'The browser is stopping.',
  launch_changed: 'The browser was relaunched, so this result belongs to an earlier launch.',
  browser_disconnected: 'The connection to the browser was lost.',
  timeout: 'The browser didn’t answer within the time limit.',
  unsupported: 'This browser build can’t report this value.',
  permission_required: 'Needs your permission. Use “Observe timezone and language”.',
  probe_closed: 'The diagnostic tab was closed before it finished.',
  probe_navigated: 'The diagnostic tab navigated away, so its result was discarded.',
  collection_failed: 'The value couldn’t be collected.',
};
export const SOURCE_TEXT = {
  browser_protocol: 'Browser protocol',
  process_command_line: 'Browser process observation',
  launch_snapshot: 'Launch snapshot',
  visible_probe: 'Visible diagnostic tab',
  manifest: 'Chromium manifest',
};
const STATE_TEXT = {
  complete: 'Complete',
  partial: 'Partial — some values are unavailable',
  unavailable: 'Unavailable',
  invalidated: 'Invalidated — the launch changed during collection',
};
const CONSISTENCY_TEXT = { match: 'Versions match', mismatch: 'Version mismatch', unknown: 'Can’t compare' };
const PROXY_TYPE = { http: 'HTTP', https: 'HTTPS', socks5: 'SOCKS5' };
const ERROR_TEXT = {
  INVALID_REQUEST: 'The request was rejected as invalid. Refresh the observation and try again.',
  UNAUTHORIZED: 'This session isn’t authorized. Restart Profile Manager to start a new session.',
  PROFILE_NOT_FOUND: 'This profile no longer exists. Choose another profile.',
  LAUNCH_CHANGED: 'The browser was relaunched; refresh the observation first.',
  DIAGNOSTICS_BUSY: 'A diagnostic observation is already running for this profile. Wait a moment, then try again.',
  INTERNAL_ERROR: 'An unexpected error occurred while collecting diagnostics.',
};
const LIFECYCLE_TEXT = { 'profile:started': 'launched', 'profile:stopped': 'stopped', 'profile:crashed': 'closed unexpectedly', launch_changed: 'relaunched' };
export const DISCLOSURE = 'Opens a visible diagnostic tab in the selected browser profile to read its timezone and language settings. Your existing pages will not be inspected. The tab will remain open until you close it.';
// DiagnosticsV1 addendum A1 (owner-approved §7.9 exception); DISCLOSURE above is unchanged contract text.
export const LOCALE_FAILURE_CLOSE_NOTE = 'If the profile\'s language settings cannot be applied to the diagnostic tab, the app closes only that tab. Your other tabs are not affected.';
export const DESKTOP_ONLY = 'Profile diagnostics are available in the Profile Manager desktop app.';
const FRESH_CEILING_MS = 30000;

const fmtTime = iso => { const d = new Date(iso); return Number.isNaN(+d) ? '—' : d.toLocaleTimeString(); };
const Time = ({ iso }) => <time dateTime={iso} title={iso}>{fmtTime(iso)}</time>;
function errorText(err) {
  if (!err) return '';
  if (err.kind === 'malformed') return 'The diagnostics response didn’t match the DiagnosticsV1 format, so nothing from it is shown.';
  if (err.kind === 'wrong_profile') return 'The diagnostics response was for a different profile, so it was discarded.';
  if (err.kind === 'network') return 'Couldn’t reach Profile Manager’s local server. Check that the app is still running.';
  return ERROR_TEXT[err.code] || `The request failed (HTTP ${err.status}).`;
}
function ErrorNote({ err, label }) {
  if (!err) return null;
  return <div className="notice warn pd-error" role="alert" data-error-code={err.code || err.kind}>
    <div><strong>{label}: </strong>{errorText(err)}
      {err.code === 'INTERNAL_ERROR' && <div className="small pd-sub">{err.requestId ? <>Request ID for support: <code>{err.requestId}</code></> : <>No request ID was returned to the app. For support, note the time: <Time iso={err.at} />.</>}</div>}
      {err.kind === 'malformed' && <div className="small pd-sub">Problem: {err.detail}</div>}
    </div></div>;
}

// ---------- fact rendering ----------
function Fact({ label, fact, render = v => v, mono, hint, id }) {
  const avail = fact?.availability === 'available';
  return <div className="pd-fact" data-fact={id}>
    <dt>{label}</dt>
    <dd>
      {avail ? <span className={mono ? 'pd-mono' : 'pd-val'}>{render(fact.value)}</span>
        : <span className="pd-unavail"><span className="pill">Unavailable</span> <span className="pd-reason" data-reason={fact?.reason}>{REASON_TEXT[fact?.reason] || 'Not collected.'}</span></span>}
      {avail && <span className="pd-source">Source: {SOURCE_TEXT[fact.source]}</span>}
      {hint && <span className="pd-hint">{hint}</span>}
    </dd>
  </div>;
}
const Card = ({ title, children, id, mismatch }) => <section className={'pd-card' + (mismatch ? ' pd-card-mismatch' : '')} aria-labelledby={id} data-card={id}>
  <div className="pd-card-head"><h3 id={id}>{title}</h3></div>{children}</section>;

// ---------- disclosure dialog (fresh consent per request) ----------
function Disclosure({ profileName, onConfirm, onCancel }) {
  const ref = useRef(null), titleId = useId(), descId = useId();
  useEffect(() => {
    const el = ref.current; el.querySelector('[data-autofocus]')?.focus();
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
      if (e.key !== 'Tab') return;
      const f = [...el.querySelectorAll('button:not([disabled])')];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!el.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onCancel]);
  return <div className="modal" onMouseDown={e => e.target === e.currentTarget && onCancel()}>
    <div ref={ref} className="card pd-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId}>
      <div className="card-head"><h3 id={titleId}>Observe timezone and language</h3></div>
      <div className="card-body">
        <p id={descId} className="pd-disclosure" data-disclosure>{DISCLOSURE}</p>
        <p className="muted" data-disclosure-addendum>{LOCALE_FAILURE_CLOSE_NOTE}</p>
        <p className="muted">Profile: <strong className="pd-name">{profileName}</strong>. You’ll be asked again for every observation.</p>
      </div>
      <div className="card-foot">
        <button data-autofocus onClick={onCancel}>Cancel</button>
        <button className="primary" onClick={() => onConfirm(CONSENT)}>Open diagnostic tab</button>
      </div>
    </div></div>;
}

// ---------- profile picker (searchable, grouped by folder; selection never fetches diagnostics) ----------
function ProfilePicker({ profiles, selected, onSelect, loadError }) {
  const [q, setQ] = useState(''), searchId = useId(), listId = useId();
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hit = p => !needle || [p.name, p.folder, ...(p.tags || [])].some(x => String(x || '').toLowerCase().includes(needle));
    const m = new Map();
    for (const p of [...profiles].sort((a, b) => String(a.name).localeCompare(String(b.name)))) if (hit(p) || p.id === selected) {
      const k = p.folder || ''; if (!m.has(k)) m.set(k, []); m.get(k).push(p);
    }
    return [...m.entries()].sort(([a], [b]) => (a === '') - (b === '') || a.localeCompare(b));
  }, [profiles, q, selected]);
  const count = groups.reduce((n, [, l]) => n + l.length, 0);
  return <div className="pd-picker">
    <label htmlFor={searchId} className="label">Find a profile</label>
    <input id={searchId} type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Name, folder or tag" autoComplete="off" />
    <label htmlFor={listId} className="label pd-list-label">Profile <span className="muted">({count} shown)</span></label>
    <select id={listId} size={6} value={selected || ''} onChange={e => onSelect(e.target.value || null)}>
      {/* Without a matching option React would visually select the first profile while none is selected. */}
      {!selected && <option value="">No profile selected</option>}
      {groups.map(([folder, list]) => <optgroup key={folder || '\u0000'} label={folder || 'No folder'}>
        {list.map(p => <option key={p.id} value={p.id}>{p.name} — {statusLabel(p)}</option>)}
      </optgroup>)}
    </select>
    {loadError && <p className="err-text small" role="alert">Couldn’t load profiles.</p>}
    {!loadError && !profiles.length && <p className="muted">No profiles yet.</p>}
  </div>;
}
const statusLabel = p => ({ running: 'Running', stopped: 'Stopped', error: 'Error' })[statusOf(p)];

// ---------- main component ----------
export const ProfileDiagnostics = React.memo(function ProfileDiagnostics() {
  const toast = useToast();
  const [profiles, setProfiles] = useState([]), [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState(null), [asking, setAsking] = useState(false), [, tick] = useState(0);
  const observeBtn = useRef(null);
  const loadGen = useRef(0);
  const loadProfiles = useCallback(async () => {
    const mine = ++loadGen.current;
    try { const r = await api('/api/profiles'); if (mine === loadGen.current) { setProfiles(Array.isArray(r) ? r : []); setLoadError(false); } }
    catch { if (mine === loadGen.current) setLoadError(true); }
  }, []);
  useEffect(() => { loadProfiles(); }, [loadProfiles]);
  // The profile list (not diagnostics) follows profile:* events so the availability label stays current.
  const D = useProfileDiagnostics(selected, { onProfileEvent: loadProfiles });
  const profile = profiles.find(p => p.id === selected) || null;
  const mine = D.profileId === selected; // ignore hook state for a previous selection during the reset render
  const rt = mine ? D.runtime : { status: 'idle' }, env = mine ? D.env : { status: 'idle' };
  const data = mine ? D.runtimeData : null; // ok, or kept through a transient error (429, 500, network)
  const envData = mine ? D.envData : null;
  const obs = data?.observation;

  // Freshness: fresh until min(validUntil, completedAt + 30 s). Timer only re-renders; it never fetches.
  const freshUntil = obs?.validUntil ? Math.min(Date.parse(obs.validUntil), Date.parse(obs.completedAt) + FRESH_CEILING_MS) : null;
  const fresh = freshUntil != null && Date.now() < freshUntil && !rt.superseded;
  useEffect(() => {
    if (freshUntil == null) return;
    const ms = freshUntil - Date.now(); if (ms <= 0) return;
    const t = setTimeout(() => tick(n => n + 1), ms + 30); return () => clearTimeout(t);
  }, [freshUntil]);

  // Status announcements for the aria-live region.
  const announce = !D.available ? DESKTOP_ONLY : !selected ? 'No profile selected.'
    : rt.status === 'loading' ? 'Requesting observation…'
    : env.status === 'loading' ? 'Opening the diagnostic tab and reading timezone and language…'
    : rt.status === 'error' ? 'Observation failed. ' + errorText(rt.error)
    : env.status === 'error' ? 'Timezone and language observation failed. ' + errorText(env.error)
    : rt.superseded ? `The browser ${LIFECYCLE_TEXT[rt.superseded.type] || 'changed'} after this observation. Refresh to re-observe.`
    : obs ? `Observation ${STATE_TEXT[obs.state].toLowerCase()}. ${fresh ? 'Fresh.' : 'Stale — refresh to re-observe.'}`
    : 'No observation yet. Use Refresh observation.';

  const confirmEnv = async consent => {
    setAsking(false);
    requestAnimationFrame(() => observeBtn.current?.focus());
    const ok = await D.observeEnvironment(consent);
    if (ok) toast('Diagnostic tab opened. It stays open until you close it.', 'success');
  };
  const cancelEnv = useCallback(() => { setAsking(false); requestAnimationFrame(() => observeBtn.current?.focus()); }, []);

  // Environment values: from the POST result only when it belongs to the same launch as the runtime observation.
  const envOther = !!envData && !D.envMatchesLaunch;
  const envSrc = envData && D.envMatchesLaunch ? envData : data;
  const envFromProbe = envSrc && envSrc !== data;

  const why = !D.available ? DESKTOP_ONLY : !selected ? 'Choose a profile first.' : !data ? 'Refresh the observation first.'
    : rt.superseded ? 'The browser changed since this observation. Refresh it first.'
    : !obs.launchId ? 'Needs a running profile. Launch it, then refresh the observation.'
    : obs.state === 'invalidated' ? 'This observation was invalidated. Refresh it first.' : null;

  const st = profile ? statusOf(profile) : null;
  return <section className="panel pd" aria-labelledby="pd-title" data-testid="profile-diagnostics">
    <div className="pd-head">
      <div><h2 id="pd-title">Profile diagnostics</h2>
        <p className="muted pd-lede">Read-only, on request. Nothing here runs until you choose an action, and nothing is monitored continuously.</p></div>
    </div>
    {!D.available && <p className="notice pd-desktop-only" role="note" data-desktop-only>{DESKTOP_ONLY}</p>}
    <div className="pd-top">
      <ProfilePicker profiles={profiles} selected={selected} onSelect={setSelected} loadError={loadError} />
      <div className="pd-identity" role="group" aria-label="Selected profile">
        {profile ? <>
          <div className="pd-id-name"><span className="pd-name" data-profile-name>{profile.name}</span>
            <span className={'status ' + st} data-profile-status={st}><i aria-hidden="true" />{statusLabel(profile)}</span></div>
          <dl className="pd-facts pd-compact">
            <div className="pd-fact"><dt>Folder</dt><dd>{profile.folder || <span className="muted">No folder</span>}</dd></div>
            {st === 'error' && <div className="pd-fact"><dt>Last error</dt><dd className="err-text" title={profile.last_error}>{crashSummary(profile.last_error)}</dd></div>}
          </dl>
          <div className="pd-actions">
            <button className="primary" onClick={() => D.refresh()} disabled={!D.available || D.loading || D.envLoading} aria-describedby="pd-refresh-hint">{D.loading ? 'Observing…' : 'Refresh observation'}</button>
            <button ref={observeBtn} onClick={() => { if (!D.envLoading) setAsking(true); }} disabled={!D.canObserveEnvironment && !D.envLoading} aria-disabled={D.envLoading || undefined} aria-describedby="pd-env-hint">{D.envLoading ? 'Observing…' : 'Observe timezone and language'}</button>
          </div>
          <p id="pd-refresh-hint" className="muted small">Refresh observation reads browser-level information only. It never opens or inspects a tab.</p>
          <p id="pd-env-hint" className="muted small">{why || 'Opens a visible diagnostic tab after you confirm.'}</p>
        </> : <p className="muted">Choose a profile to see its diagnostics. Selecting a profile doesn’t inspect it.</p>}
      </div>
    </div>

    <div className="pd-live" role="status" aria-live="polite" aria-atomic="true" data-live>{announce}</div>

    {selected && <>
      <ErrorNote err={rt.status === 'error' ? rt.error : null} label="Observation" />
      <ErrorNote err={env.status === 'error' ? env.error : null} label="Timezone and language" />
      {rt.status === 'loading' && !data && <div className="pd-loading" data-loading>Requesting observation…</div>}
      {rt.status === 'idle' && D.available && <p className="muted pd-empty" data-empty>No observation yet. Use <strong>Refresh observation</strong> to read this profile’s browser-level information.</p>}
      {data && <>
        <Observation obs={obs} fresh={fresh} superseded={rt.superseded} freshUntil={freshUntil} />
        <div className="pd-grid">
          <Card title="Browser runtime" id="pd-runtime" mismatch={data.consistency.chromiumVersion === 'mismatch'}>
            <dl className="pd-facts">
              <Fact id="runtime.chromiumVersion" label="Chromium version (running)" fact={data.runtime.chromiumVersion} mono />
              <Fact id="expected.chromiumVersion" label="Chromium version (expected)" fact={data.expected.chromiumVersion} mono />
              <div className="pd-fact" data-fact="consistency.chromiumVersion"><dt>Version check</dt><dd><Consistency v={data.consistency.chromiumVersion} long /></dd></div>
              <Fact id="runtime.userAgent" label="Browser-level user agent" fact={data.runtime.userAgent} mono
                hint="Reported by the browser itself. Individual pages can override their user agent, so this isn’t proof of what every page sees." />
            </dl>
          </Card>
          <Card title="Environment" id="pd-environment">
            {envOther && <p className="notice warn small" data-env-other>The timezone and language result came from a different browser launch, so it isn’t shown. Observe again for the current launch.</p>}
            {envData && D.envMatchesLaunch && env.superseded && <p className="notice warn small">The browser changed after this result was read.</p>}
            <dl className="pd-facts">
              <Fact id="environment.timezone" label="Timezone" fact={envSrc.environment.timezone} mono />
              <Fact id="environment.locale" label="Locale" fact={envSrc.environment.locale} mono />
              <Fact id="environment.languages" label="Navigator languages" fact={envSrc.environment.languages} mono render={v => v.length ? v.join(', ') : '(none reported)'} />
            </dl>
            {envFromProbe && <p className="muted small" data-env-observed>Read from the visible diagnostic tab at <Time iso={envSrc.observation.completedAt} />. That tab stays open until you close it.</p>}
          </Card>
          <Card title="Proxy" id="pd-proxy">
            <dl className="pd-facts">
              <Fact id="proxy" label="Proxy at launch" fact={data.proxy} render={v => v.configured
                ? <span className="pd-proxy"><span>{PROXY_TYPE[v.type]}</span> <span className="pd-mono">{v.host}:{String(v.port)}</span></span>
                : 'Not configured'} />
            </dl>
            <p className="muted small">Shows the configuration this launch started with. Edits made after launch aren’t reflected.</p>
          </Card>
          <Card title="WebRTC" id="pd-webrtc">
            <dl className="pd-facts">
              <Fact id="webrtc.commandLinePolicy" label="Command-line policy" fact={data.webrtc.commandLinePolicy} render={v =>
                v.state === 'present' ? <><span className="pill">Present</span> <span className="pd-mono">{v.value}</span></>
                  : v.state === 'absent' ? <><span className="pill">Absent</span> No WebRTC policy flag on the command line</>
                  : <><span className="pill bad">Conflicting</span> More than one conflicting policy flag was found</>} />
              <Fact id="webrtc.effectivePolicy" label="Effective policy" fact={data.webrtc.effectivePolicy} mono />
              <div className="pd-fact" data-fact="webrtc.iceCollection"><dt>ICE candidates</dt><dd>ICE candidates not collected in M2</dd></div>
            </dl>
            <p className="muted small">An absent flag doesn’t prove that no other WebRTC policy applies. These values don’t show whether your IP address is protected.</p>
          </Card>
        </div>
      </>}
    </>}
    {asking && profile && <Disclosure profileName={profile.name} onConfirm={confirmEnv} onCancel={cancelEnv} />}
  </section>;
});

function Consistency({ v, long }) {
  const cls = v === 'match' ? 'pill on' : v === 'mismatch' ? 'pill bad' : 'pill';
  return <span className={cls + ' pd-consistency'} data-consistency={v}>{v === 'mismatch' && <span aria-hidden="true">⚠ </span>}{CONSISTENCY_TEXT[v]}
    {long && v === 'mismatch' && <span className="pd-detail"> — the running Chromium differs from the expected version</span>}</span>;
}

function Observation({ obs, fresh, superseded, freshUntil }) {
  const staleText = 'Stale — refresh to re-observe';
  return <div className={'pd-obs' + (obs.state !== 'complete' ? ' pd-obs-' + obs.state : '')} data-observation={obs.state}>
    {superseded && <p className="notice warn small" data-superseded>The browser {LIFECYCLE_TEXT[superseded.type] || 'changed'} after this observation, so it’s out of date. Refresh to re-observe.</p>}
    <dl className="pd-obs-grid">
      <div><dt>State</dt><dd data-state={obs.state}><strong>{STATE_TEXT[obs.state]}</strong>{obs.reason && <span className="pd-reason" data-reason={obs.reason}> {REASON_TEXT[obs.reason]}</span>}</dd></div>
      <div><dt>Freshness</dt><dd data-fresh={fresh ? 'fresh' : 'stale'}>{fresh
        ? <span className="ok-text">Fresh until <Time iso={new Date(freshUntil).toISOString()} /></span>
        : <span className="pd-stale">{obs.validUntil ? staleText : 'No validity period — refresh to re-observe'}</span>}</dd></div>
      <div><dt>Requested</dt><dd><Time iso={obs.requestedAt} /></dd></div>
      <div><dt>Completed</dt><dd><Time iso={obs.completedAt} /></dd></div>
      <div><dt>Duration</dt><dd>{`${Math.round(obs.durationMs)} ms`}</dd></div>
      <div><dt>Launch</dt><dd>{obs.launchId ? <span className="pd-mono pd-trunc" title={obs.launchId}>{obs.launchId}</span> : <span className="muted">No running launch</span>}</dd></div>
    </dl>
    <p className="muted small">A one-time snapshot taken when you asked, not live monitoring.</p>
  </div>;
}
