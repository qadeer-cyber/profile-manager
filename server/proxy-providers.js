// Documented proxy-provider adapters.
//
// Manual host/port/username/password remains the fallback and is unchanged.
// These adapters only emit connection parameters that the provider documents,
// and they call only the HTTP endpoints cited below. They do not sell, invent,
// or simulate a proxy service. Secrets stay encrypted in SQLite and are not
// returned by the public account or proxy objects.
//
// Bright Data (native proxy + account balance):
//   https://docs.brightdata.com/proxy-networks/config-options
//   https://docs.brightdata.com/api-reference/proxy/rotate_ips
//   https://docs.brightdata.com/general/faqs  (port 44445; 22225 and 33335 expired 2026-09-25)
//   https://docs.brightdata.com/api-reference/account-management-api/Get_total_balance_through_API
//   Host brd.superproxy.io:44445. Username brd-customer-<id>-zone-<zone>
//   with optional -country-<cc>, -session-<id>, and -const (only with -session).
//   Balance: GET https://api.brightdata.com/customer/balance
//   Authorization: Bearer <account API key>  (this is not the zone password).
//
// Oxylabs residential:
//   https://developers.oxylabs.io/products/proxies/residential-proxies
//   https://developers.oxylabs.io/products/proxies/residential-proxies/session-control
//   Host pr.oxylabs.io:7777. Username customer-<user> with optional -cc-<country>,
//   -sessid-<id> or -sessid_oneip-<id>, and -sesstime-<minutes 1..1440>.
//   Oxylabs does not document an account-usage endpoint that this adapter calls.
//
// Webshare:
//   https://apidocs.webshare.io/
//   https://apidocs.webshare.io/proxy-list/list
//   GET https://proxy.webshare.io/api/v2/proxy/list/?mode=direct|backbone
//   GET https://proxy.webshare.io/api/v2/profile/
//   Authorization: Token <api key>
//   Direct proxies are fixed endpoints. This adapter does not invent a session-rotation parameter.
import crypto from 'crypto';
import { db } from './db.js';
import { encrypt, decrypt } from './secrets.js';

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SESSION = /^[A-Za-z0-9]{1,64}$/;
const COUNTRY = /^[a-z]{2}$/;

let fetchImpl = (...args) => globalThis.fetch(...args);
export function setProviderFetch(fn) { fetchImpl = fn || ((...args) => globalThis.fetch(...args)); }

export function providerCatalog() {
  return [
    {
      id: 'brightdata',
      name: 'Bright Data',
      docs: 'https://docs.brightdata.com/proxy-networks/config-options',
      sessionControl: true,
      usageSupported: true,
      manualFallback: true,
      notes: 'Builds brd.superproxy.io:44445 usernames. -session- keeps an IP; a new session id rotates; omit session to rotate every request. -const is only sent together with -session. Balance uses the separate account API key.',
    },
    {
      id: 'oxylabs',
      name: 'Oxylabs Residential',
      docs: 'https://developers.oxylabs.io/products/proxies/residential-proxies/session-control',
      sessionControl: true,
      usageSupported: false,
      manualFallback: true,
      notes: 'Builds pr.oxylabs.io:7777 usernames. sessid keeps an IP for 10 minutes; sesstime extends it up to 1440 minutes; sessid_oneip fails instead of rotating when the exit leaves. No documented usage API is called.',
    },
    {
      id: 'webshare',
      name: 'Webshare',
      docs: 'https://apidocs.webshare.io/proxy-list/list',
      sessionControl: false,
      usageSupported: true,
      manualFallback: true,
      notes: 'Imports the proxies your API key can list. Direct endpoints are fixed. Profile is read from the documented profile endpoint. Passwords from the list are stored encrypted and are not returned.',
    },
  ];
}

function cleanConfig(provider, config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw fail(400, 'config must be an object', 'INVALID_PROVIDER');
  if (provider === 'brightdata') {
    const customerId = String(config.customerId || '').trim();
    const zone = String(config.zone || '').trim();
    if (!ID.test(customerId) || !ID.test(zone)) throw fail(400, 'Bright Data customerId and zone must be 1-64 letters, digits, hyphen, or underscore', 'INVALID_PROVIDER');
    return { customerId, zone };
  }
  if (provider === 'oxylabs') {
    const username = String(config.username || '').trim();
    if (!ID.test(username)) throw fail(400, 'Oxylabs username must be 1-64 letters, digits, hyphen, or underscore', 'INVALID_PROVIDER');
    return { username };
  }
  if (provider === 'webshare') return {};
  throw fail(400, 'provider must be brightdata, oxylabs, or webshare', 'INVALID_PROVIDER');
}

function publicAccount(row) {
  let config = {};
  try { config = JSON.parse(row.config || '{}'); } catch { config = {}; }
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    config,
    hasSecret: !!row.secret,
    hasApiToken: !!row.api_token,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listAccounts() {
  return db.prepare('SELECT * FROM provider_accounts ORDER BY created_at DESC, rowid DESC').all().map(publicAccount);
}

export function createAccount({ provider, label, secret = '', apiToken = '', config = {} }) {
  const name = String(provider || '');
  if (!providerCatalog().some(item => item.id === name)) throw fail(400, 'provider must be brightdata, oxylabs, or webshare', 'INVALID_PROVIDER');
  const title = String(label || '').trim();
  if (!title || title.length > 80) throw fail(400, 'label must be 1 to 80 characters', 'INVALID_PROVIDER');
  if (typeof secret !== 'string' || typeof apiToken !== 'string') throw fail(400, 'secret and apiToken must be strings', 'INVALID_PROVIDER');
  if ((name === 'brightdata' || name === 'oxylabs') && !secret) throw fail(400, 'this provider requires the proxy password', 'INVALID_PROVIDER');
  if (name === 'webshare' && !secret) throw fail(400, 'Webshare requires the API token', 'INVALID_PROVIDER');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO provider_accounts (id,provider,label,secret,api_token,config,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, name, title, secret ? encrypt(secret) : '', apiToken ? encrypt(apiToken) : '', JSON.stringify(cleanConfig(name, config)), now, now);
  return publicAccount(db.prepare('SELECT * FROM provider_accounts WHERE id=?').get(id));
}

export function deleteAccount(id) {
  const result = db.prepare('DELETE FROM provider_accounts WHERE id=?').run(id);
  if (!result.changes) throw fail(404, 'provider account not found', 'NOT_FOUND');
}

function mustAccount(id) {
  const row = db.prepare('SELECT * FROM provider_accounts WHERE id=?').get(id);
  if (!row) throw fail(404, 'provider account not found', 'NOT_FOUND');
  let config = {};
  try { config = JSON.parse(row.config || '{}'); } catch { throw fail(500, 'provider config is unreadable', 'INVALID_PROVIDER'); }
  let secret = '';
  let apiToken = '';
  try { secret = row.secret ? decrypt(row.secret) : ''; apiToken = row.api_token ? decrypt(row.api_token) : ''; }
  catch { throw fail(500, 'Cannot decrypt this provider credential. Enter it again.', 'SECRET_UNREADABLE'); }
  return { ...publicAccount(row), config, secret, apiToken };
}

function sessionOptions(provider, options = {}) {
  const country = options.country == null || options.country === '' ? '' : String(options.country).trim().toLowerCase();
  if (country && !COUNTRY.test(country)) throw fail(400, 'country must be a two-letter code', 'INVALID_PROVIDER');
  const session = options.session == null || options.session === '' ? '' : String(options.session).trim();
  if (session && !SESSION.test(session)) throw fail(400, 'session must be 1-64 letters or digits', 'INVALID_PROVIDER');
  if (provider === 'brightdata') {
    if (options.constSession && !session) throw fail(400, 'Bright Data documents -const only together with -session', 'INVALID_PROVIDER');
    return { country, session, constSession: !!options.constSession };
  }
  if (provider === 'oxylabs') {
    const sesstime = options.sesstime == null || options.sesstime === '' ? null : Number(options.sesstime);
    if (sesstime != null && (!Number.isInteger(sesstime) || sesstime < 1 || sesstime > 1440)) throw fail(400, 'sesstime must be an integer from 1 to 1440', 'INVALID_PROVIDER');
    if (sesstime != null && !session) throw fail(400, 'Oxylabs documents sesstime only together with a session id', 'INVALID_PROVIDER');
    if (options.oneIp && !session) throw fail(400, 'sessid_oneip requires a session id', 'INVALID_PROVIDER');
    return { country, session, sesstime, oneIp: !!options.oneIp };
  }
  if (session || country || options.constSession || options.oneIp || options.sesstime) {
    throw fail(400, 'Webshare direct proxies do not document session or country parameters on the proxy username', 'UNSUPPORTED_PROVIDER_CONTROL');
  }
  return {};
}

export function buildEndpoint(id, options = {}) {
  const account = mustAccount(id);
  const opts = sessionOptions(account.provider, options);
  if (account.provider === 'brightdata') {
    let username = `brd-customer-${account.config.customerId}-zone-${account.config.zone}`;
    if (opts.country) username += `-country-${opts.country}`;
    if (opts.session) username += `-session-${opts.session}`;
    if (opts.constSession) username += '-const';
    return {
      provider: 'brightdata',
      providerRef: account.config.zone,
      providerMeta: { country: opts.country || null, session: opts.session || null, constSession: opts.constSession },
      type: 'http',
      host: 'brd.superproxy.io',
      port: 44445,
      username,
      password: account.secret,
      name: `Bright Data ${account.config.zone}${opts.session ? ' ' + opts.session : ''}`,
    };
  }
  if (account.provider === 'oxylabs') {
    let username = `customer-${account.config.username}`;
    if (opts.country) username += `-cc-${opts.country}`;
    if (opts.session) username += `-${opts.oneIp ? 'sessid_oneip' : 'sessid'}-${opts.session}`;
    if (opts.sesstime) username += `-sesstime-${opts.sesstime}`;
    const type = options.type || 'http';
    if (!['http', 'https', 'socks5'].includes(type)) throw fail(400, 'Oxylabs type must be http, https, or socks5', 'INVALID_PROVIDER');
    return {
      provider: 'oxylabs',
      providerRef: account.config.username,
      providerMeta: { country: opts.country || null, session: opts.session || null, sesstime: opts.sesstime, oneIp: opts.oneIp },
      type,
      host: 'pr.oxylabs.io',
      port: 7777,
      username,
      password: account.secret,
      name: `Oxylabs ${account.config.username}${opts.session ? ' ' + opts.session : ''}`,
    };
  }
  throw fail(400, 'Webshare proxies are imported from the documented list API, not built from a username template', 'UNSUPPORTED_PROVIDER_CONTROL');
}

function scrub(text, secret) {
  const value = String(text || '').slice(0, 300);
  return secret ? value.split(secret).join('[redacted]') : value;
}

async function providerFetch(url, { headers, secret, timeoutMs = 15000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { headers, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw fail(502, `Provider returned HTTP ${response.status}: ${scrub(text, secret)}`, 'PROVIDER_HTTP');
    try { return JSON.parse(text); }
    catch { throw fail(502, 'Provider response was not JSON', 'PROVIDER_HTTP'); }
  } catch (error) {
    if (error.code === 'PROVIDER_HTTP') throw error;
    throw fail(502, 'Provider request failed', 'PROVIDER_HTTP');
  } finally {
    clearTimeout(timer);
  }
}

export async function providerUsage(id) {
  const account = mustAccount(id);
  if (account.provider === 'oxylabs') {
    return { supported: false, provider: 'oxylabs', reason: 'Oxylabs does not document an account-usage endpoint that this adapter calls. Use the local proxy test for health and latency.' };
  }
  if (account.provider === 'brightdata') {
    if (!account.apiToken) return { supported: true, available: false, provider: 'brightdata', reason: 'Balance requires the Bright Data account API key. The zone password is a different credential and is not sent to this endpoint.' };
    const body = await providerFetch('https://api.brightdata.com/customer/balance', { headers: { Authorization: `Bearer ${account.apiToken}` }, secret: account.apiToken });
    const numeric = {};
    for (const key of ['balance', 'credit', 'prepayment', 'pending_costs']) if (typeof body?.[key] === 'number') numeric[key] = body[key];
    return { supported: true, available: true, provider: 'brightdata', source: 'https://api.brightdata.com/customer/balance', usage: numeric };
  }
  const body = await providerFetch('https://proxy.webshare.io/api/v2/profile/', { headers: { Authorization: `Token ${account.secret}` }, secret: account.secret });
  const allow = new Set(['id', 'email', 'username', 'first_name', 'last_name']);
  const fields = {};
  const omittedKeys = [];
  for (const [key, value] of Object.entries(body || {})) {
    if (allow.has(key) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) fields[key] = value;
    else omittedKeys.push(key);
  }
  return { supported: true, available: true, provider: 'webshare', source: 'https://proxy.webshare.io/api/v2/profile/', fields, omittedKeys };
}

function webshareItem(item) {
  if (!item || typeof item.proxy_address !== 'string' || !Number.isInteger(item.port)) throw fail(502, 'Webshare list item is missing an address', 'PROVIDER_HTTP');
  return {
    provider: 'webshare',
    providerRef: item.id == null ? null : String(item.id),
    providerMeta: { valid: typeof item.valid === 'boolean' ? item.valid : null, lastVerification: item.last_verification || null, countryCode: item.country_code || null },
    type: 'http',
    host: item.proxy_address,
    port: item.port,
    username: String(item.username || ''),
    password: String(item.password || ''),
    name: `Webshare ${item.proxy_address}:${item.port}`,
  };
}

export async function listWebshareProxies(id, { mode = 'direct', pages = 1 } = {}) {
  if (mode !== 'direct' && mode !== 'backbone') throw fail(400, 'Webshare mode must be direct or backbone', 'INVALID_PROVIDER');
  const account = mustAccount(id);
  if (account.provider !== 'webshare') throw fail(400, 'only a Webshare account can import the proxy list', 'INVALID_PROVIDER');
  const cap = Math.min(5, Math.max(1, Number(pages) || 1));
  const items = [];
  let url = `https://proxy.webshare.io/api/v2/proxy/list/?mode=${mode}&page=1&page_size=100`;
  for (let page = 0; page < cap && url; page += 1) {
    const body = await providerFetch(url, { headers: { Authorization: `Token ${account.secret}` }, secret: account.secret });
    for (const item of body.results || []) items.push(webshareItem(item));
    const next = typeof body.next === 'string' ? body.next : '';
    url = next.startsWith('https://proxy.webshare.io/') ? next : '';
  }
  return items;
}
