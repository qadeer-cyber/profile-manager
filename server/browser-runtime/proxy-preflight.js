// Manual-mode proxy preflight decision (Chrome Stable). Before a Manual proxy profile opens, AZWAH checks the proxy
// through the same route outside the browser. The result is one of:
//   verified      the proxy answered and its exit IP (and, when the database has it, location) is known
//   block         the proxy itself is wrong or down: wrong credentials, unresolvable host, refused/offline
//   inconclusive  the proxy may be fine but the check could not finish: timeout, exit-IP service down,
//                 location database missing, exit IP changed during the check, GeoIP setup missing
// Only "block" stops the launch. "inconclusive" is never reported as verified, and a missing location database
// is never reported as a proxy failure. Chrome itself never falls back to a direct connection.
export const BLOCKING_CODES = Object.freeze(['PROXY_AUTH_REQUIRED', 'PROXY_DNS_FAILED', 'PROXY_UPSTREAM_UNAVAILABLE']);

export function manualProxyPreflight(result, error) {
  if (result && !error) {
    return { state: 'verified', exitIp: result.ip ?? null, country: result.country ?? null, source: result.source ?? null };
  }
  const code = error?.code || (/timed out/i.test(error?.message || '') ? 'PROXY_CHECK_TIMEOUT' : 'PROXY_CHECK_FAILED');
  if (BLOCKING_CODES.includes(code)) return { state: 'block', code };
  return { state: 'inconclusive', code };
}
