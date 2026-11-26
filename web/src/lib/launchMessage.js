// The toast after a launch. For a Manual proxy profile it states what the pre-launch proxy check found, and never
// calls an unfinished check "verified".
const REASONS = {
  PROXY_CHECK_TIMEOUT: 'the check timed out',
  PROXY_PROBE_TIMEOUT: 'the check timed out',
  PROXY_EXIT_SERVICE_UNAVAILABLE: 'the exit-IP service did not answer',
  PROXY_LOCATION_UNAVAILABLE: 'the location database had no answer',
  PROXY_EXIT_ROTATED: 'the exit IP changed during the check',
  GEOIP_CREDENTIALS_UNAVAILABLE: 'location lookup is not set up',
};
export function launchMessage(name, result) {
  const pf = result?.proxyPreflight;
  if (!pf) return { text: `Launched ${name}`, kind: 'success' };
  if (pf.state === 'verified') {
    const where = [pf.exitIp, pf.country].filter(Boolean).join(', ');
    return { text: `Launched ${name}. Proxy checked${where ? `: exit ${where}` : ''}.`, kind: 'success' };
  }
  return { text: `Launched ${name}. The proxy check could not finish (${REASONS[pf.code] || 'unknown reason'}); traffic still goes only through the proxy.`, kind: 'warning' };
}
