// Classify a public-origin fetch of a loopback target. A successful response
// means the page was able to reach that local port. Masked scan results are
// not produced here.

export function classifyLocalNetworkProbe({ permissionState = null, fetchOk = false, errorName = '' } = {}) {
  if (permissionState !== 'denied') {
    return { status: 'fail', reason: 'permission_not_denied', errorName: errorName || null };
  }
  if (fetchOk) return { status: 'fail', reason: 'fetch_succeeded', errorName: errorName || null };
  return { status: 'pass', reason: 'blocked', errorName: errorName || 'blocked' };
}

export function probeOutcomeChanged(control, treatment) {
  const controlReached = control?.fetchOk === true;
  const treatmentBlocked = treatment?.fetchOk === false && treatment?.permissionState === 'denied';
  return controlReached && treatmentBlocked;
}
