import { isIPv4 } from 'node:net';
import { probeProxyExit, resolveProxyLocation } from '../server/proxy-location.js';

const protocols = ['http', 'https', 'socks5'];
const safeErrors = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'ETIMEDOUT',
  'EHOSTUNREACH', 'ABORT_ERR', 'PROXY_AUTH_REQUIRED', 'PROXY_LOCATION_UNAVAILABLE',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED',
  'EPROTO', 'DEPTH_ZERO_SELF_SIGNED_CERT']);
const code = error => safeErrors.has(error.code) ? error.code : 'connection-or-negotiation-failed';

try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 32000) throw new Error();
  }
  const { endpoints, username, password, service, account, license } = JSON.parse(input);
  input = '';
  if (!Array.isArray(endpoints) || endpoints.length < 1 || endpoints.length > 24 ||
      new Set(endpoints).size !== endpoints.length || typeof username !== 'string' || !username ||
      typeof password !== 'string' || !['geoip', 'geolite', 'none'].includes(service) ||
      (service !== 'none' && (!account || !license))) throw new Error();
  const targets = endpoints.map(endpoint => {
    const match = typeof endpoint === 'string' && endpoint.match(/^([0-9.]+):(\d{1,5})$/);
    if (!match || !isIPv4(match[1]) || +match[2] < 1 || +match[2] > 65535) throw new Error();
    return { endpoint, host: match[1], port: +match[2] };
  });
  async function inspect({ endpoint, host, port }) {
    const attempts = [];
    for (const type of protocols) {
      const proxy = { type, host, port, username, password };
      let observed;
      try { observed = await probeProxyExit(proxy); }
      catch (error) {
        attempts.push({ protocol: type, status: code(error) });
        continue;
      }
      const row = { protocol: type, status: 'verified-exit', ...observed };
      try {
        const anonymous = await probeProxyExit({ type, host, port });
        row.authentication = anonymous.ip === observed.ip ? 'same-exit-without-credentials' : 'different-exit-without-credentials';
      } catch (error) {
        row.authentication = error.code === 'PROXY_AUTH_REQUIRED' ? 'proxy-explicitly-rejected-anonymous' : 'anonymous-probe-failed';
      }
      if (service !== 'none') {
        try {
          const geo = await resolveProxyLocation(proxy, { service, credentials: () => ({ account, license }) });
          if (geo.ip !== observed.ip) row.locationStatus = 'exit-changed';
          else Object.assign(row, { timezone: geo.timezone, region: geo.region, country: geo.country,
            city: geo.city, accuracyKm: geo.radiusKm, locationStatus: 'verified-provider-result' });
        } catch (error) { row.locationStatus = code(error); }
      } else row.locationStatus = 'skipped';
      attempts.push(row);
    }
    return { endpoint, attempts };
  }
  const results = [];
  for (let i = 0; i < targets.length; i += 3) {
    for (const result of await Promise.all(targets.slice(i, i + 3).map(inspect))) {
      results.push(result);
      console.log(JSON.stringify(result));
    }
  }
  const zones = new Set(results.flatMap(row => row.attempts.map(attempt => attempt.timezone).filter(Boolean)));
  const workingEndpoints = results.filter(row => row.attempts.some(attempt => attempt.status === 'verified-exit')).length;
  const regionalPair = results.some((row, i) => row.attempts.some(a => a.timezone &&
    results.slice(i + 1).some(peer => peer.attempts.some(b => b.timezone && a.timezone !== b.timezone && a.ip !== b.ip))));
  console.log(JSON.stringify({ testedEndpoints: results.length, workingEndpoints,
    verifiedTimezones: [...zones].sort(), regionalPairAvailable: regionalPair }));
} catch {
  console.error('Proxy inventory failed. Check the input format and Node dependencies.');
  process.exitCode = 1;
}
