import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { Reader } from 'mmdb-lib';
import tzLookup from 'tz-lookup';

export const DBIP_SOURCE = 'DB-IP City Lite';
const day = 86_400_000;
const maxDatabaseBytes = 256 * 1024 * 1024;
const caches = new Map();
const unavailable = () => Object.assign(new Error(
  'The offline proxy-location database is unavailable or has no usable record for this exit IP. Retry after the database updates or choose another proxy.',
), { code: 'PROXY_LOCATION_UNAVAILABLE', status: 503 });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// The two free DB-IP Lite datasets AZWAH uses (CC BY 4.0): city (proxy location) and ASN (exit network owner).
const DATASETS = {
  city: { page: 'https://db-ip.com/db/download/ip-to-city-lite', prefix: 'dbip-city-lite', folder: 'geoip-dbip', type: t => t === 'DBIP-City-Lite' },
  asn: { page: 'https://db-ip.com/db/download/ip-to-asn-lite', prefix: 'dbip-asn-lite', folder: 'geoip-dbip-asn', type: t => /^DBIP-ASN-Lite/.test(t) },
};

export function parseDbipRelease(html, prefix = 'dbip-city-lite') {
  const pattern = new RegExp(`href=['"](https:\\/\\/download\\.db-ip\\.com\\/free\\/${prefix}-(\\d{4}-(?:0[1-9]|1[0-2]))\\.mmdb\\.gz)['"]`, 'gi');
  const links = [...html.matchAll(pattern)];
  if (links.length !== 1) throw unavailable();
  const [link] = links;
  const previous = html.slice(Math.max(0, link.index - 2000), link.index);
  const checksum = /SHA1SUM<\/dt>\s*<dd[^>]*>([a-f0-9]{40})<\/dd>\s*<\/dl>\s*<div[^>]*>\s*<a\s*$/i.exec(previous);
  if (!checksum) throw unavailable();
  return { url: link[1], month: link[2], sha1: checksum[1].toLowerCase() };
}

async function get(url, timeout) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(timeout) });
  if (!response.ok || !response.body) throw unavailable();
  return response;
}

async function readDatabase(directory) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(manifest.month) ||
      !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw unavailable();
  const bytes = await readFile(path.join(directory, manifest.sha256 + '.mmdb'));
  if (bytes.length > maxDatabaseBytes || sha256(bytes) !== manifest.sha256) throw unavailable();
  return { ...manifest, reader: new Reader(bytes) };
}

export async function refreshDbipDatabase(directory, current, kind = 'city') {
  const dataset = DATASETS[kind];
  const page = await get(dataset.page, 15_000);
  const release = parseDbipRelease(await page.text(), dataset.prefix);
  if (current && release.month <= current.month) return current;
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, randomUUID());
  const manifestFile = temporary + '.json';
  const publishedHash = createHash('sha1');
  const localHash = createHash('sha256');
  let bytes = 0;
  const verifier = new Transform({
    transform(chunk, _, callback) {
      bytes += chunk.length;
      if (bytes > maxDatabaseBytes) return callback(unavailable());
      publishedHash.update(chunk);
      localHash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    const download = await get(release.url, 180_000);
    await pipeline(Readable.fromWeb(download.body), createGunzip(), verifier, createWriteStream(temporary, { flags: 'wx' }));
    if (publishedHash.digest('hex') !== release.sha1) throw unavailable();
    const hash = localHash.digest('hex');
    const reader = new Reader(await readFile(temporary));
    if (!dataset.type(reader.metadata.databaseType)) throw unavailable();
    await rename(temporary, path.join(directory, hash + '.mmdb'));
    const manifest = { month: release.month, sha256: hash };
    await writeFile(manifestFile, JSON.stringify(manifest), { flag: 'wx' });
    await rename(manifestFile, path.join(directory, 'manifest.json'));
    if (current && current.sha256 !== hash) {
      await rm(path.join(directory, current.sha256 + '.mmdb'), { force: true }).catch(() => {});
    }
    return { ...manifest, reader };
  } finally {
    await Promise.all([temporary, manifestFile].map(file => rm(file, { force: true }).catch(() => {})));
  }
}

export function dbipRecordLocation(record, ip, timezoneAt = tzLookup) {
  const { latitude, longitude } = record?.location || {};
  const country = record?.country?.iso_code;
  if (!/^[A-Z]{2}$/.test(country || '') || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      !Number.isFinite(longitude) || Math.abs(longitude) > 180) throw unavailable();
  let timezone;
  try {
    const zone = timezoneAt(latitude, longitude);
    if (!zone.includes('/') || zone.startsWith('Etc/')) throw unavailable();
    timezone = new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone;
  } catch { throw unavailable(); }
  return {
    ip, latitude, longitude, timezone, country, city: record.city?.names?.en ?? null,
    region: record.subdivisions?.[0]?.names?.en ?? null,
    approximate: true, radiusKm: null,
    // CDP requires a numeric accuracy. This conservative value is policy,
    // not an accuracy measurement provided by DB-IP.
    accuracy: 1_000_000, accuracyEstimated: true,
  };
}

// Loads a dataset from the data folder (refreshed monthly) or the copy shipped with the installer.
async function currentDataset(kind) {
  const { folder } = DATASETS[kind];
  const directory = path.resolve(process.env.PM_DATA_DIR || 'data', folder);
  let state = caches.get(directory);
  if (!state) {
    state = { nextCheck: 0 };
    state.initial = readDatabase(directory).catch(() => process.resourcesPath
      ? readDatabase(path.join(process.resourcesPath, folder)).catch(() => null)
      : null).then(value => { state.current = value; });
    caches.set(directory, state);
  }
  await state.initial;
  if (!state.refresh && Date.now() >= state.nextCheck) {
    state.nextCheck = Date.now() + day;
    state.refresh = refreshDbipDatabase(directory, state.current, kind).then(value => { state.current = value; })
      .catch(() => { if (!state.current) state.nextCheck = Date.now() + 60_000; })
      .finally(() => { state.refresh = null; });
  }
  if (!state.current) await state.refresh;
  return state.current;
}

export async function lookupDbipLocation(ip) {
  const current = await currentDataset('city');
  if (!current) throw unavailable();
  return dbipRecordLocation(current.reader.get(ip), ip);
}

// Network owners whose names say hosting, cloud or data center. A name match is evidence, not proof;
// anything else is reported as unknown rather than guessed to be residential.
const HOSTING = /\b(amazon|aws|google|microsoft|azure|digitalocean|ovh|hetzner|linode|akamai|vultr|constant company|choopa|m247|leaseweb|contabo|datacamp|cloudflare|oracle|alibaba|tencent|scaleway|online s\.?a\.?s|ionos|hostinger|godaddy|hostwinds|psychz|quadranet|colocrossing|servers\.com|g-core|gcore|cdn77|zenlayer|hosting|host|cloud|data ?cent(er|re)|datacenter|server|vps|colo)/i;
export function classifyNetwork(organization) {
  const match = typeof organization === 'string' ? HOSTING.exec(organization) : null;
  return match ? { type: 'hosting', matched: match[0] } : { type: 'unknown' };
}
const networkUnavailable = () => Object.assign(new Error('The offline network database has no record for this exit IP.'),
  { code: 'PROXY_NETWORK_UNAVAILABLE', status: 503 });
export function dbipRecordNetwork(record, ip) {
  const asn = record?.autonomous_system_number;
  if (!Number.isInteger(asn)) throw networkUnavailable();
  const organization = record.autonomous_system_organization || null;
  return { ip, asn, organization, type: classifyNetwork(organization).type, source: 'DB-IP ASN Lite' };
}
export async function lookupDbipNetwork(ip) {
  const current = await currentDataset('asn');
  if (!current) throw networkUnavailable();
  return dbipRecordNetwork(current.reader.get(ip), ip);
}
