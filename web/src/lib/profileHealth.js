// Profile Health: one summary of what a website would see for a profile and where the layers disagree.
// Pure functions (no React) so node --test covers them. Nothing here invents a value: a row is "ok" only when a
// live browser observation matched the saved setting, and everything else says why it was not measured.

export const HEALTH_GROUPS = Object.freeze([
  { id: 'network', label: 'Network', categories: ['webrtc'] },
  { id: 'locale', label: 'Time and language', categories: ['timezone', 'languages', 'geolocationAccess', 'geolocationData'] },
  { id: 'device', label: 'Device', categories: ['deviceIdentity', 'userAgent', 'navigatorHardware', 'screen'] },
  { id: 'graphics', label: 'Graphics and fonts', categories: ['webglMetadata', 'webgl', 'canvas', 'audio', 'webgpu', 'fonts'] },
  { id: 'media', label: 'Media and local network', categories: ['mediaDevices', 'portScan'] },
]);

// Display state of one row. `real` = no setting to compare, the value is this computer's real one.
const STATE = Object.freeze({ pass: 'ok', warning: 'mismatch', partial: 'partial', unavailable: 'unmeasured', 'real-only': 'real' });
export const STATE_LABEL = Object.freeze({ ok: 'Matches', mismatch: 'Mismatch', partial: 'Partly measured', unmeasured: 'Not measured', real: 'Real value' });

// Checks that need no running browser: the saved settings compared with the stored proxy-exit evidence.
export function configChecks(profile) {
  const rows = [];
  const loc = profile?.lastProxyLocation || null;
  if (!profile?.proxy) {
    rows.push({ id: 'proxy', label: 'Proxy', group: 'network', state: 'real',
      summary: 'Direct connection: websites see this computer’s own IP address.' });
    return rows;
  }
  if (!loc) {
    rows.push({ id: 'proxy', label: 'Proxy exit', group: 'network', state: 'unmeasured',
      summary: 'The proxy exit has not been checked yet. Launch the profile once to record it.' });
    return rows;
  }
  rows.push({ id: 'proxy', label: 'Proxy exit', group: 'network', state: 'ok',
    summary: `Exit ${loc.ip}${loc.timezone ? ` · ${loc.timezone}` : ''} was recorded for the current proxy.` });
  const chosen = profile.browserSettings?.timezoneId;
  if (chosen && loc.timezone && chosen !== loc.timezone) {
    rows.push({ id: 'proxy_timezone', label: 'Timezone vs proxy', group: 'locale', state: 'mismatch',
      summary: `The profile uses ${chosen} but the proxy exit is in ${loc.timezone}. Sites can see both.` });
  }
  return rows;
}

function rowFromCategory(row, running) {
  const state = STATE[row.status] || 'unmeasured';
  const warnings = (row.findings || []).filter(f => f.status === 'warning').map(f => f.summary);
  const anyFinding = (row.findings || []).find(f => f.status !== 'unsupported')?.summary;
  let summary;
  if (state === 'mismatch') summary = warnings.join(' ');
  else if (state === 'unmeasured') summary = running ? 'The browser did not report this value.' : 'Launch the profile to measure this.';
  else summary = anyFinding || (state === 'real' ? 'No setting; this is the real value of this computer.' : '');
  return { id: row.id, label: row.label, state, summary };
}

// byCategory: consistency.byCategory from GET /api/profiles/:id/hardware (null before the first read).
export function buildHealth({ profile, running = false, byCategory = null } = {}) {
  const cfg = configChecks(profile);
  const live = new Map((byCategory || []).map(r => [r.id, rowFromCategory(r, running)]));
  const groups = HEALTH_GROUPS.map(g => ({
    id: g.id, label: g.label,
    rows: [...cfg.filter(r => r.group === g.id), ...g.categories.map(id => live.get(id)).filter(Boolean)],
  })).filter(g => g.rows.length);
  const rows = groups.flatMap(g => g.rows);
  const counts = { ok: 0, mismatch: 0, partial: 0, unmeasured: 0, real: 0 };
  for (const r of rows) counts[r.state]++;
  let verdict, headline;
  if (counts.mismatch) { verdict = 'attention'; headline = `${counts.mismatch} mismatch${counts.mismatch === 1 ? '' : 'es'} to fix`; }
  else if (!running) { verdict = 'idle'; headline = 'Not running. Launch the profile to measure what sites see.'; }
  else if (!byCategory) { verdict = 'partial'; headline = 'Nothing measured yet'; }
  else if (counts.unmeasured || counts.partial) { verdict = 'partial'; headline = `${counts.unmeasured + counts.partial} check${counts.unmeasured + counts.partial === 1 ? '' : 's'} not fully measured`; }
  else { verdict = 'ok'; headline = 'Every measured value matches the profile settings'; }
  return { verdict, headline, counts, groups };
}

// Cheap badge for the profile table: only checks that need no browser (so it works for every row at once).
export function healthBadge(profile) {
  const bad = configChecks(profile).filter(r => r.state === 'mismatch');
  return bad.length ? { state: 'mismatch', title: bad.map(r => r.summary).join(' ') } : null;
}
