// Collect ICE candidate types from a live page. This does not compare addresses to
// a proxy and does not claim a leak-free session.
const ICE_GATHER_MS = 3500;

function candidateType(line) {
  const match = / typ (\w+)/.exec(line || '');
  return match ? match[1] : 'unknown';
}

function addressClass(line) {
  const match = / (\d{1,3}(?:\.\d{1,3}){3}) /.exec(line || '');
  if (!match) return 'unknown';
  const parts = match[1].split('.').map(Number);
  if (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168)) return 'private';
  if (parts[0] === 127) return 'loopback';
  return 'public';
}

export function summarizeIceCandidates(lines) {
  const counts = { host: 0, srflx: 0, relay: 0, prflx: 0, unknown: 0 };
  const addressClasses = { private: 0, public: 0, loopback: 0, unknown: 0 };
  for (const line of lines || []) {
    const typ = candidateType(line);
    if (counts[typ] != null) counts[typ] += 1;
    else counts.unknown += 1;
    const cls = addressClass(line);
    addressClasses[cls] += 1;
  }
  return {
    availability: 'observed',
    candidateCount: lines.length,
    types: counts,
    addressClasses,
    note: 'Candidate lines are summarized by type and address class. They are not compared to the proxy exit IP.',
  };
}

export async function gatherIceInPage(page) {
  return page.evaluate(async timeoutMs => {
    if (!window.RTCPeerConnection) return { availability: 'unavailable', reason: 'webrtc_api_missing' };
    const lines = [];
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.createDataChannel('pm-ice-probe');
    const done = new Promise(resolve => {
      const timer = setTimeout(() => resolve('timeout'), timeoutMs);
      pc.onicecandidate = event => {
        if (event.candidate && event.candidate.candidate) lines.push(event.candidate.candidate);
        else { clearTimeout(timer); resolve('complete'); }
      };
    });
    try {
      await pc.setLocalDescription(await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false }));
      await done;
    } catch {
      return { availability: 'unavailable', reason: 'ice_gather_failed' };
    } finally {
      pc.close();
    }
    return { availability: 'observed', lines };
  }, ICE_GATHER_MS);
}

export function iceConsistencyFinding(webrtcMode, iceSummary) {
  if (!iceSummary || iceSummary.availability !== 'observed') {
    return {
      id: 'webrtc_ice',
      status: 'unavailable',
      summary: iceSummary?.reason === 'webrtc_api_missing'
        ? 'This page has no RTCPeerConnection, so ICE was not collected.'
        : 'ICE candidates were not collected on this run.',
    };
  }
  const { types, candidateCount, addressClasses } = iceSummary;
  const parts = [`${candidateCount} candidate line(s)`, `host ${types.host}`, `srflx ${types.srflx}`, `relay ${types.relay}`].join(', ');
  if (webrtcMode === 'browser_default') {
    return {
      id: 'webrtc_ice',
      status: 'pass',
      summary: `Observed ICE: ${parts}. No policy flag is set. These results are not compared to the proxy.`,
    };
  }
  if (webrtcMode === 'disable_non_proxied_udp' && types.srflx + types.relay > 0) {
    return {
      id: 'webrtc_ice',
      status: 'warning',
      summary: `Observed ICE: ${parts}. disable_non_proxied_udp is saved, but srflx or relay candidates appeared. That is not proof of a leak and is not compared to the proxy IP.`,
    };
  }
  return {
    id: 'webrtc_ice',
    status: 'pass',
    summary: `Observed ICE: ${parts}. Saved policy is ${webrtcMode}. Candidate types were recorded only; no claim is made that WebRTC matches the proxy.`,
  };
}
