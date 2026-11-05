import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-provider-contract-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'provider-contract';
const fixtureDir = path.join(import.meta.dirname, 'fixtures', 'providers');
const load = name => JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
const fixtures = {
  balance: load('brightdata-balance.json'),
  zone: load('brightdata-zone-status.json'),
  oxylabs: load('oxylabs-client-stats.json'),
  list: load('webshare-list.json'),
  profile: load('webshare-profile.json'),
  subscription: load('webshare-subscription.json'),
};

const { startServer } = await import('../server/app.js');
const { setProviderFetch } = await import('../server/proxy-providers.js');
let server;
const seen = [];

const call = async (method, url, payload) => {
  const response = await fetch(server.url + url, {
    method,
    headers: { Authorization: 'Bearer provider-contract', 'Content-Type': 'application/json' },
    body: payload == null ? undefined : JSON.stringify(payload),
  });
  const text = await response.text();
  return { status: response.status, text, body: text ? JSON.parse(text) : null };
};

function schemeOf(header) {
  const value = String(header || '');
  if (value.startsWith('Bearer ')) return 'Bearer';
  if (value.startsWith('Token ')) return 'Token';
  return 'other';
}

before(async () => {
  server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' });
  setProviderFetch(async (url, options) => {
    seen.push({ url, scheme: schemeOf(options?.headers?.Authorization) });
    const table = {
      'https://api.brightdata.com/customer/balance': fixtures.balance,
      'https://api.brightdata.com/zone/status?zone=residential': fixtures.zone,
      'https://residential-api.oxylabs.io/v2/users/11111111-1111-4111-8111-111111111111/client-stats': fixtures.oxylabs,
      'https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page=1&page_size=100': fixtures.list,
      'https://proxy.webshare.io/api/v2/profile/': fixtures.profile,
      'https://proxy.webshare.io/api/v2/subscription/': fixtures.subscription,
    };
    const body = table[url];
    if (!body) return { ok: false, status: 404, async text() { return 'unrecorded'; } };
    return { ok: true, status: 200, async text() { return JSON.stringify(body); } };
  });
});

after(async () => {
  setProviderFetch(null);
  if (server) await server.close();
  try { const { db } = await import('../server/db.js'); db.close(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  delete process.env.PM_DATA_DIR;
  delete process.env.PM_API_TOKEN;
});

test('recorded provider contracts parse usage without returning fixture secrets', async () => {
  const brightSecret = 'fixture-bright-zone-password';
  const brightToken = 'fixture-bright-api-token';
  const bright = await call('POST', '/api/v1/proxy-providers/accounts', {
    provider: 'brightdata',
    label: 'BD contract',
    secret: brightSecret,
    apiToken: brightToken,
    config: { customerId: 'cust1', zone: 'residential' },
  });
  assert.equal(bright.status, 201);
  const brightUsage = await call('POST', `/api/v1/proxy-providers/accounts/${bright.body.id}/usage`, {});
  assert.equal(brightUsage.status, 200, brightUsage.text);
  assert.equal(brightUsage.body.usage.balance, 12.5);
  assert.equal(brightUsage.body.zoneStatus.status, 'active');
  assert.equal(brightUsage.body.zoneStatus.password, '[redacted]');
  assert.equal(brightUsage.text.includes(brightSecret), false);
  assert.equal(brightUsage.text.includes(brightToken), false);
  assert.equal(brightUsage.text.includes('fixture-bright-password-must-not-leak'), false);
  assert.equal(brightUsage.text.includes('fixture-bright-zone-password-must-not-leak'), false);
  assert.ok(seen.some(row => row.url === 'https://api.brightdata.com/customer/balance' && row.scheme === 'Bearer'));
  assert.ok(seen.some(row => row.url === 'https://api.brightdata.com/zone/status?zone=residential' && row.scheme === 'Bearer'));

  const oxySecret = 'fixture-oxylabs-proxy-password';
  const oxyToken = 'fixture-oxylabs-jwt';
  const oxy = await call('POST', '/api/v1/proxy-providers/accounts', {
    provider: 'oxylabs',
    label: 'Oxy contract',
    secret: oxySecret,
    apiToken: oxyToken,
    config: { username: 'alice', userId: '11111111-1111-4111-8111-111111111111' },
  });
  const oxyUsage = await call('POST', `/api/v1/proxy-providers/accounts/${oxy.body.id}/usage`, {});
  assert.equal(oxyUsage.body.stats.traffic, 4096);
  assert.equal(oxyUsage.body.stats.unit, 'bytes');
  assert.equal('apiToken' in oxyUsage.body.stats, false);
  assert.equal(oxyUsage.text.includes(oxySecret), false);
  assert.equal(oxyUsage.text.includes(oxyToken), false);
  assert.equal(oxyUsage.text.includes('fixture-oxylabs-token-must-not-leak'), false);
  assert.ok(seen.some(row => row.url.startsWith('https://residential-api.oxylabs.io/v2/users/') && row.scheme === 'Bearer'));

  const webToken = 'fixture-webshare-api-token';
  const web = await call('POST', '/api/v1/proxy-providers/accounts', {
    provider: 'webshare',
    label: 'WS contract',
    secret: webToken,
    config: {},
  });
  const imported = await call('POST', `/api/v1/proxy-providers/accounts/${web.body.id}/import`, { mode: 'direct' });
  assert.equal(imported.body.created, 1);
  assert.equal(imported.text.includes('fixture-webshare-password-must-not-leak'), false);
  assert.equal(imported.text.includes(webToken), false);
  const usage = await call('POST', `/api/v1/proxy-providers/accounts/${web.body.id}/usage`, {});
  assert.equal(usage.body.fields.email, 'fixture@example.com');
  assert.equal(usage.body.subscription.bandwidth_limit, 10);
  assert.equal(usage.text.includes('fixture-webshare-profile-password-must-not-leak'), false);
  assert.equal(usage.text.includes('fixture-webshare-subscription-key-must-not-leak'), false);
  assert.equal(usage.text.includes(webToken), false);
  assert.ok(seen.some(row => row.url.startsWith('https://proxy.webshare.io/api/v2/proxy/list/') && row.scheme === 'Token'));
  assert.ok(seen.some(row => row.url === 'https://proxy.webshare.io/api/v2/profile/' && row.scheme === 'Token'));
  assert.ok(seen.filter(row => row.scheme === 'other').length === 0);
});

test('live provider usage when PM_PROVIDER_LIVE=1', { skip: process.env.PM_PROVIDER_LIVE !== '1' }, async () => {
  const names = ['PM_BRIGHTDATA_API_TOKEN', 'PM_BRIGHTDATA_CUSTOMER_ID', 'PM_BRIGHTDATA_ZONE', 'PM_BRIGHTDATA_ZONE_PASSWORD', 'PM_OXYLABS_API_TOKEN', 'PM_OXYLABS_USER_ID', 'PM_OXYLABS_USERNAME', 'PM_OXYLABS_PASSWORD', 'PM_WEBSHARE_TOKEN'];
  const missing = names.filter(name => !process.env[name]);
  assert.equal(missing.length, 0, `Set ${missing.join(', ')} in the environment. Do not commit them.`);
  setProviderFetch(null);
  const bright = await call('POST', '/api/v1/proxy-providers/accounts', {
    provider: 'brightdata', label: 'BD live', secret: process.env.PM_BRIGHTDATA_ZONE_PASSWORD, apiToken: process.env.PM_BRIGHTDATA_API_TOKEN,
    config: { customerId: process.env.PM_BRIGHTDATA_CUSTOMER_ID, zone: process.env.PM_BRIGHTDATA_ZONE },
  });
  assert.equal(bright.status, 201);
  const usage = await call('POST', `/api/v1/proxy-providers/accounts/${bright.body.id}/usage`, {});
  assert.equal(usage.body.provider, 'brightdata');
  assert.equal(usage.body.available, true);
  assert.equal(usage.text.includes(process.env.PM_BRIGHTDATA_API_TOKEN), false);
  assert.equal(usage.text.includes(process.env.PM_BRIGHTDATA_ZONE_PASSWORD), false);
});
