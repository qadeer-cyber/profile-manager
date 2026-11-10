import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
]) blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) {
  blocked.addSubnet(network, prefix, 'ipv6');
}
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const fail = (message, code = 'PROXY_LOCATION_UNAVAILABLE') => Object.assign(new Error(message), { status: 503, code });

export function publicIp(value) {
  if (typeof value !== 'string' || value.includes('%')) return null;
  const version = isIP(value);
  if (version === 4 && !blocked.check(value, 'ipv4')) return value;
  if (version === 6 && globalV6.check(value, 'ipv6') && !blocked.check(value, 'ipv6')) {
    return new URL(`https://[${value}]/`).hostname.slice(1, -1);
  }
  return null;
}

export function validateProxyLocation(payload, ip) {
  const { latitude, longitude, accuracy_radius: radiusKm, time_zone: timezone } = payload?.location || {};
  if (publicIp(payload?.traits?.ip_address) !== ip || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      !Number.isFinite(longitude) || Math.abs(longitude) > 180 || !Number.isSafeInteger(radiusKm) || radiusKm < 1 ||
      typeof timezone !== 'string' || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$/.test(timezone)) {
    throw fail('The GeoIP response did not confirm the proxy IP, coordinates, accuracy and timezone.');
  }
  let canonical;
  try { canonical = new Intl.DateTimeFormat('en', { timeZone: timezone }).resolvedOptions().timeZone; }
  catch { throw fail('The GeoIP provider returned an unsupported timezone.'); }
  return {
    ip, latitude, longitude, accuracy: radiusKm * 1000, radiusKm, timezone: canonical,
    country: payload.country?.iso_code ?? null, region: payload.subdivisions?.[0]?.names?.en ?? null,
    city: payload.city?.names?.en ?? null, approximate: true,
  };
}

function requestJson(url, agent, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent, headers, signal: AbortSignal.timeout(10000) }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(response.statusCode === 407 ? fail('The proxy rejected authentication.', 'PROXY_AUTH_REQUIRED') :
          fail('The proxy or location service returned an unsuccessful response.'));
        return;
      }
      let bytes = 0;
      const chunks = [];
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 65536) response.destroy(fail('The location service response was too large.'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(fail('The location service returned invalid data.')); }
      });
    });
    req.on('error', reject);
  });
}

const exitEndpoint = 'https://api64.ipify.org?format=json';
const cityServices = Object.freeze({
  geoip: { origin: 'https://geoip.maxmind.com', label: 'MaxMind GeoIP City' },
  geolite: { origin: 'https://geolite.info', label: 'MaxMind GeoLite City' },
});

function proxyAgent(proxy) {
  if (!proxy) throw fail('Assign a proxy or select Manual or System location.');
  if (!['http', 'https', 'socks5'].includes(proxy.type)) throw fail('Unsupported proxy protocol.');
  const auth = proxy.username ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || '')}@` : '';
  const protocol = proxy.type === 'socks5' ? 'socks5h' : proxy.type;
  const host = isIP(proxy.host) === 6 ? `[${proxy.host}]` : proxy.host;
  const upstream = `${protocol}://${auth}${host}:${proxy.port}`;
  return protocol === 'socks5h' ? new SocksProxyAgent(upstream) : new HttpsProxyAgent(upstream);
}

export async function probeProxyExit(proxy, { request = requestJson } = {}) {
  const agent = proxyAgent(proxy);
  const started = performance.now();
  try {
    const ip = publicIp((await request(exitEndpoint, agent))?.ip);
    if (!ip) throw fail('The assigned proxy did not return a valid public exit IP.');
    return { ip, latencyMs: Math.round(performance.now() - started) };
  } finally { agent.destroy(); }
}

export async function resolveProxyLocation(proxy, { read, save, request = requestJson, now = Date.now, credentials,
  service = process.env.AZWAH_MAXMIND_SERVICE || 'geoip' } = {}) {
  if (!Object.hasOwn(cityServices, service)) throw fail('Select geoip or geolite for AZWAH_MAXMIND_SERVICE.');
  const provider = cityServices[service];
  let agent;
  try {
    agent = proxyAgent(proxy);
    const observe = async () => publicIp((await request(exitEndpoint, agent))?.ip);
    const ip = await observe();
    if (!ip) throw fail('The assigned proxy did not return a valid public exit IP.');
    const cached = read?.();
    if (cached?.ip === ip && (cached.source ?? cityServices.geoip.label) === provider.label && cached.proxyId === proxy.id &&
        (cached.proxyRevision ?? null) === (proxy.revision ?? null) && cached.expiresAt > now()) return cached;
    const { account, license: key } = credentials ? credentials() : {
      account: process.env.AZWAH_MAXMIND_ACCOUNT_ID, license: process.env.AZWAH_MAXMIND_LICENSE_KEY,
    };
    if (!account || !key) throw fail('Proxy location requires a configured MaxMind GeoIP account. Configure MaxMind City in Settings → Proxy location.');
    const payload = await request(`${provider.origin}/geoip/v2.1/city/${encodeURIComponent(ip)}`, agent,
      { Authorization: 'Basic ' + Buffer.from(`${account}:${key}`).toString('base64') });
    const location = validateProxyLocation(payload, ip);
    if (await observe() !== ip) throw fail('The proxy exit IP changed during location detection. Retry with a consistent proxy exit.');
    const result = { ...location, source: provider.label, proxyId: proxy.id, proxyRevision: proxy.revision ?? null, expiresAt: now() + 24 * 60 * 60 * 1000 };
    save?.(result);
    return result;
  } catch (error) {
    if (['PROXY_LOCATION_UNAVAILABLE', 'GEOIP_CREDENTIALS_UNAVAILABLE', 'PROXY_AUTH_REQUIRED'].includes(error.code)) throw error;
    throw fail('Proxy location could not be verified. Check proxy connectivity and the MaxMind City web-service credentials in Settings → Proxy location.');
  } finally { agent?.destroy(); }
}
