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

// The only difference that counts is the deny preference. Address space is held
// fixed inside each pair. A pass means the request completed without the
// preference and did not complete with it.
export function summarizeCausalProbe(cells) {
  const list = Array.isArray(cells) ? cells : [];
  const find = (space, deny) => list.find(cell => cell.space === space && !!cell.deny === deny);
  const pairs = ['local', 'public'].map(space => {
    const absent = find(space, false);
    const deny = find(space, true);
    return {
      space,
      causal: probeOutcomeChanged(absent, deny),
      absent: absent ? { fetchOk: !!absent.fetchOk, permissionState: absent.permissionState || null, body: absent.body || '' } : null,
      deny: deny ? { fetchOk: !!deny.fetchOk, permissionState: deny.permissionState || null, body: deny.body || '' } : null,
    };
  });
  const causal = pairs.some(pair => pair.causal);
  return {
    causal,
    pairs,
    note: causal
      ? 'The deny preference changes whether the request completes.'
      : 'The deny preference is not the cause. Where the request succeeds without it, it still succeeds with it. Where a public-classified initiator is blocked, it stays blocked with the preference absent or present.',
  };
}
