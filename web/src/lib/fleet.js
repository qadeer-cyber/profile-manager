// Fleet summary model for the profiles header. Pure (no React). The bar splits profiles by run state (running, stopped
// with an error, idle). "Proxy failed" overlaps those states (a profile can be running with a proxy that failed its last
// test), so it is a separate count of profiles and never part of the bar. It reports the last stored proxy test, not a live probe.
export function fleetModel({ total = 0, running = 0, errors = 0, proxyFailed = 0 } = {}) {
  const idle = Math.max(0, total - running - errors);
  const pct = n => (total ? Math.min(100, (n / total) * 100) : 0);
  const keys = [
    { key: 'run', count: running, label: 'running', scope: 'running' },
    { key: 'idle', count: idle, label: 'idle', scope: null },
    ...(errors > 0 ? [{ key: 'err', count: errors, label: 'stopped with an error', scope: 'error' }] : []),
    ...(proxyFailed > 0 ? [{ key: 'proxy', count: proxyFailed, label: 'with a failed proxy test', scope: 'proxy_failed' }] : []),
  ];
  return { total, segments: [{ key: 'run', pct: pct(running) }, { key: 'err', pct: pct(errors) }], keys };
}

// Scopes opened from the fleet header or the sidebar that force a status filter in the profile table.
export const SCOPE_STATUS = Object.freeze({ running: 'running', error: 'error', proxy_failed: 'proxy_failed' });
export const SCOPE_LABEL = Object.freeze({ running: 'Running', error: 'Stopped with an error', proxy_failed: 'Proxy failed', favorites: 'Favorites' });

// What the row badge and menu need to know about the assigned proxy's last test.
export function proxyTestState(profile, now = Date.now()) {
  const test = profile?.proxy?.lastTest;
  if (!profile?.proxy) return { state: 'none' };
  if (!test?.status) return { state: 'untested' };
  const at = test.testedAt ? new Date(test.testedAt) : null;
  const when = at && !Number.isNaN(+at) ? at : null;
  const ageMinutes = when ? Math.max(0, Math.round((now - +when) / 60000)) : null;
  return { state: test.status === 'failed' ? 'failed' : 'ok', error: test.error || '', testedAt: test.testedAt || null, ageMinutes };
}
