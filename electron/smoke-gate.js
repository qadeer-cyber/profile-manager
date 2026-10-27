// Launch routing for the packaged entry. No Electron and no backend imports.
// PM_SMOKE_PHASE is read only after both smoke gates are set, so a normal
// user launch (no smoke env) cannot reach the rejection path.
export const SMOKE_PHASES = Object.freeze(['clean', 'upgrade', 'seed', 'check', 'lifecycle']);

export function selectSmokePhase(value) {
  if (typeof value !== 'string' || !SMOKE_PHASES.includes(value)) {
    const shown = value === undefined || value === null || value === '' ? '(missing)' : JSON.stringify(value);
    throw Object.assign(new Error(`PM_SMOKE_PHASE must be one of ${SMOKE_PHASES.join(', ')}; got ${shown}`), { code: 'SMOKE_PHASE' });
  }
  return value;
}

export function classifyLaunch(env) {
  if (env.PM_SMOKE !== '1') return { mode: 'app' };
  if (env.PM_SMOKE_OFFLINE !== '1') return { mode: 'desktop-smoke' };
  try {
    return { mode: 'offline', phase: selectSmokePhase(env.PM_SMOKE_PHASE) };
  } catch (err) {
    const error = err.message;
    const raw = env.PM_SMOKE_PHASE;
    return {
      mode: 'rejected',
      error,
      body: { phase: raw == null || raw === '' ? null : raw, error },
    };
  }
}

// Sync write of the harness result. The caller exits non-zero immediately after.
export function writeSmokeRejection(env, body, writeFileSync) {
  if (!env.PM_SMOKE_RESULT) return;
  writeFileSync(env.PM_SMOKE_RESULT, JSON.stringify(body, null, 2));
}
