// Loopback HTTP traffic controls with measured byte counters.
// savingsBytes is only the difference between two completed sessions that share a scriptId.
// Blocked requests that were never fetched do not invent a byte figure by themselves.
import http from 'node:http';
import crypto from 'node:crypto';
import { db } from './db.js';

export const TRAFFIC_SAVINGS_NOTE = 'originResponseBytes counts origin response body bytes actually read. savingsBytes is baseline minus controlled only when both sessions share scriptId, attempted the same number of requests, the baseline policy is disabled, and the controlled policy blocked at least one request. HTTPS CONNECT tunnels are not metered. Unpaired blocks do not invent savings.';

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const EXT = /^\.[a-z0-9]{1,8}$/;
const SCRIPT_ID = /^[A-Za-z0-9_.:-]{1,80}$/;

export function normalizeTrafficPolicy(input) {
  if (input == null) return { enabled: false, blockExtensions: [] };
  if (typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'trafficPolicy must be an object', 'INVALID_TRAFFIC_POLICY');
  const enabled = input.enabled === true;
  const raw = Array.isArray(input.blockExtensions) ? input.blockExtensions : [];
  if (enabled && raw.length === 0) throw fail(400, 'enabled traffic policy needs at least one block extension', 'INVALID_TRAFFIC_POLICY');
  const blockExtensions = [];
  for (const item of raw) {
    let ext = String(item || '').trim().toLowerCase();
    if (!ext) continue;
    if (!ext.startsWith('.')) ext = `.${ext}`;
    if (!EXT.test(ext)) throw fail(400, 'blockExtensions entries must look like .png', 'INVALID_TRAFFIC_POLICY');
    if (!blockExtensions.includes(ext)) blockExtensions.push(ext);
    if (blockExtensions.length > 40) throw fail(400, 'at most 40 block extensions', 'INVALID_TRAFFIC_POLICY');
  }
  return { enabled, blockExtensions };
}

export function pathBlocked(pathname, policy) {
  if (!policy?.enabled) return false;
  const path = String(pathname || '').split('?')[0].toLowerCase();
  return policy.blockExtensions.some(ext => path.endsWith(ext));
}

export function getTrafficPolicy(proxyId) {
  const row = db.prepare('SELECT enabled, block_extensions AS blockExtensions, updated_at AS updatedAt FROM proxy_traffic_policies WHERE proxy_id=?').get(proxyId);
  if (!row) return { enabled: false, blockExtensions: [], updatedAt: null, stored: false };
  return { enabled: !!row.enabled, blockExtensions: JSON.parse(row.blockExtensions || '[]'), updatedAt: row.updatedAt, stored: true };
}

export function saveTrafficPolicy(proxyId, input) {
  const policy = normalizeTrafficPolicy(input);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO proxy_traffic_policies (proxy_id, enabled, block_extensions, updated_at)
    VALUES (?,?,?,?)
    ON CONFLICT(proxy_id) DO UPDATE SET enabled=excluded.enabled, block_extensions=excluded.block_extensions, updated_at=excluded.updated_at`)
    .run(proxyId, policy.enabled ? 1 : 0, JSON.stringify(policy.blockExtensions), now);
  return getTrafficPolicy(proxyId);
}

export function copyTrafficPolicy(fromId, toId) {
  const policy = getTrafficPolicy(fromId);
  if (!policy.stored) return getTrafficPolicy(toId);
  return saveTrafficPolicy(toId, { enabled: policy.enabled, blockExtensions: policy.blockExtensions });
}

export function trafficMeasurementSummary() {
  try {
    const sessions = db.prepare('SELECT COUNT(*) n FROM proxy_traffic_sessions').get().n;
    return { sessions: sessions || 0 };
  } catch {
    return { sessions: 0 };
  }
}

function loopbackUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw fail(400, 'request url must be an absolute http URL', 'INVALID_TRAFFIC_URL'); }
  if (url.protocol !== 'http:') throw fail(400, 'metering only accepts http URLs', 'INVALID_TRAFFIC_URL');
  if (url.username || url.password) throw fail(400, 'request url must not include credentials', 'INVALID_TRAFFIC_URL');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw fail(400, 'metering only forwards to loopback', 'INVALID_TRAFFIC_URL');
  if (!url.port) throw fail(400, 'request url must include an explicit port', 'INVALID_TRAFFIC_URL');
  return url;
}

function sessionFromRow(row) {
  return {
    id: row.id,
    proxyId: row.proxy_id,
    scriptId: row.script_id,
    policy: JSON.parse(row.policy_json),
    originResponseBytes: row.origin_response_bytes,
    originRequestBytes: row.origin_request_bytes,
    blockedRequests: row.blocked_requests,
    forwardedRequests: row.forwarded_requests,
    createdAt: row.created_at,
    byteBasis: 'origin-response-body',
    invented: false,
  };
}

export function getTrafficSession(id) {
  const row = db.prepare('SELECT * FROM proxy_traffic_sessions WHERE id=?').get(id);
  if (!row) throw fail(404, 'traffic session not found', 'NOT_FOUND');
  return sessionFromRow(row);
}

export function compareTrafficSavings(baselineId, controlledId) {
  if (!baselineId || !controlledId) throw fail(400, 'baseline and controlled session ids are required', 'INVALID_TRAFFIC_COMPARE');
  if (baselineId === controlledId) throw fail(400, 'baseline and controlled sessions must differ', 'INVALID_TRAFFIC_COMPARE');
  const baseline = getTrafficSession(baselineId);
  const controlled = getTrafficSession(controlledId);
  const note = TRAFFIC_SAVINGS_NOTE;
  if (baseline.scriptId !== controlled.scriptId) {
    return { comparable: false, savingsBytes: null, savingsPercent: null, reason: 'scriptId mismatch', note, invented: false };
  }
  const baselineAttempts = baseline.forwardedRequests + baseline.blockedRequests;
  const controlledAttempts = controlled.forwardedRequests + controlled.blockedRequests;
  if (baselineAttempts !== controlledAttempts) {
    return { comparable: false, savingsBytes: null, savingsPercent: null, reason: 'request counts differ', note, invented: false };
  }
  if (baseline.policy?.enabled) {
    return { comparable: false, savingsBytes: null, savingsPercent: null, reason: 'baseline policy must be disabled', note, invented: false };
  }
  if (!controlled.policy?.enabled || controlled.blockedRequests < 1) {
    return { comparable: false, savingsBytes: null, savingsPercent: null, reason: 'controlled session did not block any request', note, invented: false };
  }
  const savingsBytes = baseline.originResponseBytes - controlled.originResponseBytes;
  const savingsPercent = baseline.originResponseBytes > 0
    ? Math.round((savingsBytes / baseline.originResponseBytes) * 1000) / 10
    : null;
  return {
    comparable: true,
    savingsBytes,
    savingsPercent,
    baselineOriginResponseBytes: baseline.originResponseBytes,
    controlledOriginResponseBytes: controlled.originResponseBytes,
    blockedRequests: controlled.blockedRequests,
    scriptId: baseline.scriptId,
    byteBasis: 'origin-response-body',
    note,
    invented: false,
  };
}

export function startMeteringProxy(policyInput) {
  const policy = normalizeTrafficPolicy(policyInput || { enabled: false, blockExtensions: [] });
  const counters = { originResponseBytes: 0, originRequestBytes: 0, blockedRequests: 0, forwardedRequests: 0 };
  const server = http.createServer((req, res) => {
    let target;
    try { target = loopbackUrl(req.url); }
    catch (error) {
      res.writeHead(error.status || 400, { 'content-type': 'text/plain' });
      res.end(error.message);
      return;
    }
    if (pathBlocked(target.pathname, policy)) {
      counters.blockedRequests += 1;
      req.resume();
      res.writeHead(403, { 'content-type': 'text/plain', 'x-pm-traffic': 'blocked', 'cache-control': 'no-store' });
      res.end('blocked by traffic policy');
      return;
    }
    const headers = { ...req.headers, host: target.host };
    for (const hop of ['proxy-connection', 'proxy-authorization', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade']) delete headers[hop];
    const upstream = http.request({
      hostname: target.hostname === 'localhost' ? '127.0.0.1' : target.hostname.replace(/^\[|\]$/g, ''),
      port: Number(target.port),
      path: `${target.pathname}${target.search}`,
      method: req.method,
      headers,
    }, up => {
      up.on('data', chunk => { counters.originResponseBytes += chunk.length; });
      up.on('end', () => { counters.forwardedRequests += 1; });
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('origin error');
    });
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      counters.originRequestBytes += body.length;
      upstream.end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        policy,
        counters,
        close: () => new Promise(done => server.close(() => done())),
      });
    });
  });
}

function proxyGet(proxyPort, absoluteUrl) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'GET',
      path: absoluteUrl,
      headers: { Host: new URL(absoluteUrl).host },
    }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode || 0));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function measureTrafficScript({ scriptId, requests, policy, proxyId = null }) {
  if (!SCRIPT_ID.test(String(scriptId || ''))) throw fail(400, 'scriptId must be 1-80 letters, digits, or . _ : -', 'INVALID_TRAFFIC_SCRIPT');
  if (!Array.isArray(requests) || requests.length < 1 || requests.length > 20) throw fail(400, 'requests must contain 1 to 20 urls', 'INVALID_TRAFFIC_SCRIPT');
  const urls = requests.map(item => {
    const url = loopbackUrl(item?.url);
    return url.toString();
  });
  const active = normalizeTrafficPolicy(policy || { enabled: false, blockExtensions: [] });
  const meter = await startMeteringProxy(active);
  try {
    for (const url of urls) {
      const status = await proxyGet(meter.port, url);
      if (status >= 500) throw fail(502, `origin returned HTTP ${status}`, 'TRAFFIC_ORIGIN');
    }
  } finally {
    await meter.close();
  }
  const row = {
    id: crypto.randomUUID(),
    proxyId: proxyId || null,
    scriptId: String(scriptId),
    policy: meter.policy,
    originResponseBytes: meter.counters.originResponseBytes,
    originRequestBytes: meter.counters.originRequestBytes,
    blockedRequests: meter.counters.blockedRequests,
    forwardedRequests: meter.counters.forwardedRequests,
    createdAt: new Date().toISOString(),
  };
  db.prepare(`INSERT INTO proxy_traffic_sessions
    (id, proxy_id, script_id, policy_json, origin_response_bytes, origin_request_bytes, blocked_requests, forwarded_requests, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    row.id, row.proxyId, row.scriptId, JSON.stringify(row.policy),
    row.originResponseBytes, row.originRequestBytes, row.blockedRequests, row.forwardedRequests, row.createdAt,
  );
  return getTrafficSession(row.id);
}
