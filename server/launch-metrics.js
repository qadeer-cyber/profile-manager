// In-process launch timings (real performance.now() deltas; not estimated).
const warmedProfiles = new Set();
const lastByProfile = new Map();

export function beginLaunchMetrics(profileId) {
  return {
    profileId,
    warmStart: warmedProfiles.has(profileId),
    startedAt: performance.now(),
    contextReadyAt: null,
    browserReadyAt: null,
  };
}

export function markContextReady(handle) {
  if (handle && handle.contextReadyAt == null) handle.contextReadyAt = performance.now();
}

export function markBrowserReady(handle) {
  if (handle && handle.browserReadyAt == null) handle.browserReadyAt = performance.now();
}

function roundMs(value) {
  return value == null ? null : Math.round(value * 10) / 10;
}

export function finalizeLaunchMetrics(handle, { success = true, errorCode = null } = {}) {
  if (!handle) return null;
  const end = performance.now();
  const metrics = {
    profileId: handle.profileId,
    warmStart: handle.warmStart,
    success,
    errorCode,
    coldStartMs: roundMs((handle.contextReadyAt ?? end) - handle.startedAt),
    contextReadyMs: handle.contextReadyAt == null ? null : roundMs(handle.contextReadyAt - handle.startedAt),
    browserReadyMs: handle.browserReadyAt == null ? null : roundMs(handle.browserReadyAt - handle.startedAt),
    totalLaunchMs: roundMs(end - handle.startedAt),
    recordedAt: new Date().toISOString(),
  };
  if (success) warmedProfiles.add(handle.profileId);
  lastByProfile.set(handle.profileId, metrics);
  return metrics;
}

export function getLaunchMetrics(profileId) {
  return lastByProfile.get(profileId) ?? null;
}

export function resetLaunchMetricsForTests() {
  warmedProfiles.clear();
  lastByProfile.clear();
}
