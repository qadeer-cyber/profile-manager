// Express app factory. Used by the CLI (server/index.js) and in-process by Electron (electron/main.js).
import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import https from 'https';
import dns from 'dns/promises';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { chromium } from 'playwright';
import { db, userDataDir, DATA_DIR, migration, getSetting, setSetting, scrubDatabaseFile } from './db.js';
import { encrypt, decrypt, needsReencrypt, loadApiToken, encryptionStatus, setStrictPrefixes } from './secrets.js';
import * as engine from './browsers.js';
import { currentVersion } from './migrations.js';
import { installVerifiedChromium, chromiumStatus, browsersRoot, isResourcesBrowsers } from './chromium.js';
import { proxyTestInsecureTls } from './testflags.js';

// ---- Browser (Chromium) install: pinned, SHA-256-verified download from the official CDN (server/chromium.js) ----
const browserInstall = { state: 'idle', log: '', error: null, code: null };
export function browserStatus() {
  let p = null; try { p = getSetting('executablePath', '') || chromium.executablePath(); } catch {}
  let verified = null; try { verified = chromiumStatus(); } catch (e) { verified = { error: e.message }; }
  return { path: p, installed: !!p && fs.existsSync(p), custom: !!getSetting('executablePath', ''), browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH || 'default', install: browserInstall, chromium: verified };
}
export function installBrowser({ install } = {}) {
  if (browserInstall.state === 'running') return null;
  // Already-present Chromium (bundled offline build or a previous download) is not fetched again.
  if (install == null && browserStatus().installed) {
    Object.assign(browserInstall, { state: 'done', log: '', error: null, code: 'ALREADY_INSTALLED' });
    return Promise.resolve();
  }
  if (install == null && isResourcesBrowsers(browsersRoot())) {
    const error = 'Refusing to install Chromium into resources/browsers';
    Object.assign(browserInstall, { state: 'failed', log: '', error, code: 'BAD_INSTALL_ROOT' });
    engine.events.emit('event', { type: 'browser:install', state: 'failed', error, code: 'BAD_INSTALL_ROOT' });
    return Promise.resolve();
  }
  install = install || installVerifiedChromium;
  Object.assign(browserInstall, { state: 'running', log: '', error: null, code: null });
  engine.events.emit('event', { type: 'browser:install', state: 'running' });
  const log = line => { browserInstall.log = (browserInstall.log + line + '\n').slice(-4000); };
  let lastPct = -1;
  const onProgress = (name, done, total) => { const pct = total ? Math.floor(done * 100 / total) : -1; if (pct !== lastPct && pct % 10 === 0) { lastPct = pct; log(`${name}: ${pct}%`); } };
  return Promise.resolve().then(() => install({ log, onProgress })).then(res => {
    for (const r of res || []) log(`Installed ${r.name} (sha256 ${r.sha256})`);
    Object.assign(browserInstall, { state: 'done' });
    engine.events.emit('event', { type: 'browser:install', state: 'done' });
  }, e => {
    Object.assign(browserInstall, { state: 'failed', error: e.message, code: e.code || null });
    engine.events.emit('event', { type: 'browser:install', state: 'failed', error: e.message, code: e.code || null });
  });
}

const err = (status, msg) => Object.assign(new Error(msg), { status });
// CHROMIUM_MISSING -> 503 {error:'CHROMIUM_MISSING', message} (same shape in /api and /api/v1)
const errorBody = e => e.code === 'CHROMIUM_MISSING' ? { error: 'CHROMIUM_MISSING', message: e.message } : { error: e.message, code: e.code, ...(e.extra || {}) };
const wrap = fn => (req, res) => Promise.resolve().then(() => fn(req, res)).catch(e => res.status(e.code === 'CHROMIUM_MISSING' ? 503 : e.status || 500).json(errorBody(e)));
const SETTINGS_DEFAULTS = { defaultHeadless: false, executablePath: '', startUrl: '' };

// Re-encrypt stored proxy secrets with the preferred backend (plaintext/AES -> safeStorage, etc.)
export function reencryptSecrets() {
  let n = 0;
  for (const r of db.prepare("SELECT id, password FROM proxies WHERE password <> ''").all()) {
    if (!needsReencrypt(r.password)) continue;
    try { db.prepare('UPDATE proxies SET password=? WHERE id=?').run(encrypt(decrypt(r.password)), r.id); n++; } catch {}
  }
  for (const r of db.prepare('SELECT id, proxy FROM profiles WHERE proxy IS NOT NULL').all()) {
    const px = JSON.parse(r.proxy);
    if (!needsReencrypt(px.password)) continue;
    try { px.password = encrypt(decrypt(px.password)); } catch { continue; }
    db.prepare('UPDATE profiles SET proxy=? WHERE id=?').run(JSON.stringify(px), r.id); n++;
  }
  return n;
}

const row2p = r => {
  if (!r) return r;
  const lib = r.proxy_id ? db.prepare('SELECT * FROM proxies WHERE id=?').get(r.proxy_id) : null;
  let proxy = null, secretError = null;
  if (lib) {
    proxy = { id: lib.id, name: lib.name, type: lib.type, host: lib.host, port: lib.port, username: lib.username, password: '' };
    try { proxy.password = decrypt(lib.password); } catch (e) { secretError = e.message; }
  }
  delete r.proxy; // legacy inline column (cleared by migration v6)
  return { ...r, tags: JSON.parse(r.tags), proxy, automationEnabled: !!r.automation_enabled, running: engine.isRunning(r.id), ...(secretError && { secretError }) };
};
const publicP = p => {
  if (!p) return p;
  const { automation_enabled, proxy_id, ...rest } = p;
  // `password` here is only a fixed mask for the legacy editor; the real value is never returned.
  const out = { ...rest, proxyId: proxy_id || null, proxy: p.proxy ? { ...p.proxy, hasPassword: !!p.proxy.password, password: p.proxy.password ? '••••' : '' } : null };
  const ri = p.running && engine.runInfo(p.id);
  if (ri) {
    out.pid = ri.pid ?? null;
    // CDP only exists when the profile was launched with automation (remote-debugging port open)
    if (ri.cdp_port) out.cdp = { wsEndpoint: ri.ws_endpoint, httpEndpoint: `http://127.0.0.1:${ri.cdp_port}`, debuggerAddress: `127.0.0.1:${ri.cdp_port}`, pid: ri.pid ?? null };
  }
  return out;
};
const get = id => row2p(db.prepare('SELECT * FROM profiles WHERE id=?').get(id));
const must = id => { const p = get(id); if (!p) throw err(404, 'not found'); return p; };

function cleanProxy(px, prev) {
  if (!px || !px.host) return null;
  if (!['http', 'https', 'socks5'].includes(px.type)) throw err(400, 'proxy.type must be http, https or socks5');
  const port = Number(px.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw err(400, 'invalid proxy.port');
  const host = String(px.host).trim();
  if (!/^[A-Za-z0-9.\-:\[\]]+$/.test(host)) throw err(400, 'invalid proxy.host');
  let password = px.password || '';
  if (password === '••••' && prev) password = prev.password || '';
  return { type: px.type, host, port, username: String(px.username || ''), password: String(password) };
}
function strictBool(v, name) { if (typeof v !== 'boolean') throw err(400, `${name} must be a boolean`); return v; }
function validate(b, prev) {
  const name = String(b.name ?? prev?.name ?? '').trim();
  if (!name) throw err(400, 'name is required');
  if (name.length > 200) throw err(400, 'name too long');
  const tags = Array.isArray(b.tags) ? b.tags : typeof b.tags === 'string' ? b.tags.split(',') : prev?.tags || [];
  return { name, tags: [...new Set(tags.map(t => String(t).trim()).filter(Boolean))],
    folder: String(b.folder ?? prev?.folder ?? '').trim(), notes: String(b.notes ?? prev?.notes ?? ''),
    proxyId: 'proxy' in b ? resolveInlineProxy(b.proxy, prev) : prev?.proxy_id ?? null,
    automationEnabled: 'automationEnabled' in b ? strictBool(b.automationEnabled, 'automationEnabled') : prev?.automationEnabled ?? false };
}
// Back-compat: inline `proxy` on profile create/update -> find-or-create a library entry.
function resolveInlineProxy(inline, prev) {
  if (!inline || !inline.host) return null;
  const px = cleanProxy(inline, prev?.proxy);
  if (prev?.proxy && prev.proxy_id && ['type', 'host', 'port', 'username', 'password'].every(k => px[k] === prev.proxy[k])) return prev.proxy_id;
  for (const r of db.prepare('SELECT id, password FROM proxies WHERE type=? AND host=? AND port=? AND username=?').all(px.type, px.host, px.port, px.username)) {
    try { if (decrypt(r.password) === px.password) return r.id; } catch {}
  }
  return createProxyRow({ ...px, name: '', tags: [] });
}
function insert(v) {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const dir = userDataDir(id);
  if (fs.existsSync(dir)) throw err(500, 'data directory collision'); // never share a data dir
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,proxy_id,automation_enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, v.name, JSON.stringify(v.tags), v.folder, v.notes, v.proxyId, v.automationEnabled ? 1 : 0, now, now);
  fs.mkdirSync(dir, { recursive: true });
  return id;
}
function list({ q = '', tag = '', folder } = {}) {
  let l = db.prepare('SELECT * FROM profiles ORDER BY created_at DESC').all().map(row2p);
  if (q) { const s = String(q).toLowerCase(); l = l.filter(p => (p.name + ' ' + p.notes + ' ' + p.tags.join(' ') + ' ' + p.folder).toLowerCase().includes(s)); }
  if (tag) l = l.filter(p => p.tags.includes(tag));
  if (folder !== undefined && folder !== '__all') l = l.filter(p => p.folder === folder);
  return l;
}
function clone(id, body = {}) {
  const p = must(id);
  const copyData = body.copyData !== false;
  if (copyData && (engine.isRunning(id))) throw err(409, `Profile "${p.name}" is running. Stop it before cloning (browser data can't be copied consistently while in use), or pass {"copyData": false} to clone settings only.`);
  const nid = insert({ ...p, proxyId: p.proxy_id || null, name: body.name || p.name + ' (copy)' });
  if (copyData) {
    const src = userDataDir(id);
    try { if (fs.existsSync(src)) fs.cpSync(src, userDataDir(nid), { recursive: true, filter: s => !engine.DATA_COPY_SKIP.has(path.basename(s)) }); }
    catch (e) { db.prepare('DELETE FROM profiles WHERE id=?').run(nid); fs.rmSync(userDataDir(nid), { recursive: true, force: true }); throw err(500, 'Clone failed while copying data: ' + e.message); }
  }
  return get(nid);
}
async function remove(id) {
  must(id); await engine.stop(id);
  db.prepare('DELETE FROM profiles WHERE id=?').run(id);
  fs.rmSync(userDataDir(id), { recursive: true, force: true });
}
const headlessDefault = () => process.env.HEADLESS === '1' || getSetting('defaultHeadless', false);
const updateHandler = (req, res) => {
  const v = validate(req.body, must(req.params.id));
  db.prepare('UPDATE profiles SET name=?,tags=?,folder=?,notes=?,proxy_id=?,automation_enabled=?,updated_at=? WHERE id=?')
    .run(v.name, JSON.stringify(v.tags), v.folder, v.notes, v.proxyId, v.automationEnabled ? 1 : 0, new Date().toISOString(), req.params.id);
  res.json(publicP(get(req.params.id)));
};
// allowOverride: only the automation API (/api/v1) may override the profile's automation flag per launch.
const doLaunch = async (id, b = {}, { allowOverride = false } = {}) => {
  const p = must(id);
  if (p.secretError) throw err(500, 'Cannot decrypt this profile\'s proxy password: ' + p.secretError + '. Re-enter it in the profile settings.');
  let automation = p.automationEnabled;
  if (allowOverride && b.automation !== undefined) automation = strictBool(b.automation, 'automation');
  await engine.launch(p, { headless: b.headless ?? headlessDefault(), url: b.url || getSetting('startUrl', '') || undefined, automation });
  return publicP(get(id));
};
const doStop = async id => { must(id); await engine.stop(id); return publicP(get(id)); };

// ---------------- Proxy library ----------------
const PROXY_TYPES = ['http', 'https', 'socks5'];
function cleanTags(t) { const a = Array.isArray(t) ? t : typeof t === 'string' ? t.split(',') : []; return [...new Set(a.map(x => String(x).trim()).filter(Boolean))].slice(0, 50); }
function validHost(h) {
  h = String(h ?? '').trim();
  if (/^\[[0-9a-fA-F:.]+\]$/.test(h)) return h;                                  // bracketed IPv6
  if (/^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(h)) return h;
  throw err(400, 'invalid proxy host');
}
function validPort(p) { const n = Number(p); if (!Number.isInteger(n) || n < 1 || n > 65535) throw err(400, 'invalid proxy port (1-65535)'); return n; }
function validType(t) { if (!PROXY_TYPES.includes(t)) throw err(400, 'proxy type must be http, https or socks5'); return t; }
function createProxyRow({ name, type, host, port, username = '', password = '', tags = [] }) {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  type = validType(type); host = validHost(host); port = validPort(port);
  name = String(name || '').trim() || `${type}://${host}:${port}`;
  if (name.length > 200) throw err(400, 'name too long');
  db.prepare('INSERT INTO proxies (id,name,type,host,port,username,password,tags,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, name, type, host, port, String(username || ''), encrypt(String(password || '')), JSON.stringify(cleanTags(tags)), now, now);
  return id;
}
const proxyRow = id => db.prepare('SELECT * FROM proxies WHERE id=?').get(id);
const mustProxy = id => { const r = proxyRow(id); if (!r) throw err(404, 'proxy not found'); return r; };
function publicProxy(r) {
  if (!r) return r;
  return { id: r.id, name: r.name, type: r.type, host: r.host, port: r.port, username: r.username, hasPassword: !!r.password, tags: JSON.parse(r.tags),
    lastTest: { status: r.last_test_status ?? null, ip: r.last_test_ip ?? null, latencyMs: r.last_test_latency_ms ?? null, error: r.last_test_error ?? null, testedAt: r.last_tested_at ?? null },
    assignedProfiles: db.prepare('SELECT COUNT(*) n FROM profiles WHERE proxy_id=?').get(r.id).n, createdAt: r.created_at, updatedAt: r.updated_at };
}
function listProxies({ q = '', tag = '', status = '' } = {}) {
  let l = db.prepare('SELECT * FROM proxies ORDER BY created_at DESC, rowid DESC').all();
  if (q) { const s = String(q).toLowerCase(); l = l.filter(r => [r.name, r.host, r.username, ...JSON.parse(r.tags)].join(' ').toLowerCase().includes(s)); }
  if (tag) l = l.filter(r => JSON.parse(r.tags).includes(tag));
  if (status === 'untested') l = l.filter(r => !r.last_test_status); else if (status) l = l.filter(r => r.last_test_status === status);
  return l.map(publicProxy);
}
function patchProxy(id, b) {
  const r = mustProxy(id);
  const next = { name: r.name, type: r.type, host: r.host, port: r.port, username: r.username, password: r.password, tags: JSON.parse(r.tags) };
  if ('name' in b) { next.name = String(b.name || '').trim() || `${next.type}://${next.host}:${next.port}`; if (next.name.length > 200) throw err(400, 'name too long'); }
  if ('type' in b) next.type = validType(b.type);
  if ('host' in b) next.host = validHost(b.host);
  if ('port' in b) next.port = validPort(b.port);
  if ('username' in b) next.username = String(b.username ?? '');
  if ('password' in b) next.password = encrypt(String(b.password ?? ''));
  if ('tags' in b) next.tags = cleanTags(b.tags);
  const endpointChanged = ['type', 'host', 'port', 'username'].some(k => next[k] !== r[k]) || 'password' in b;
  db.prepare(`UPDATE proxies SET name=?,type=?,host=?,port=?,username=?,password=?,tags=?,updated_at=?${endpointChanged ? ',last_test_status=NULL,last_test_ip=NULL,last_test_latency_ms=NULL,last_test_error=NULL,last_tested_at=NULL' : ''} WHERE id=?`)
    .run(next.name, next.type, next.host, next.port, next.username, next.password, JSON.stringify(next.tags), new Date().toISOString(), id);
  return publicProxy(proxyRow(id));
}
function deleteProxy(id, force) {
  mustProxy(id);
  const assigned = db.prepare('SELECT id, name FROM profiles WHERE proxy_id=?').all(id);
  if (assigned.length && !force) throw Object.assign(err(409, `Proxy is assigned to ${assigned.length} profile(s). Unassign it first or pass ?force=1.`), { code: 'PROXY_IN_USE', extra: { assignedProfiles: assigned } });
  db.transaction(() => { db.prepare('UPDATE profiles SET proxy_id=NULL WHERE proxy_id=?').run(id); db.prepare('DELETE FROM proxies WHERE id=?').run(id); })();
}
function assignProxy(profileId, proxyId) {
  const p = must(profileId);
  if (proxyId !== null && typeof proxyId !== 'string') throw err(400, 'proxyId must be a string or null');
  if (proxyId) mustProxy(proxyId);
  db.prepare('UPDATE profiles SET proxy_id=?, updated_at=? WHERE id=?').run(proxyId, new Date().toISOString(), profileId);
  const out = publicP(get(profileId));
  if (p.running) out.appliesOnNextLaunch = true;
  return out;
}

// Import: host:port | host:port:user:pass | scheme://[user:pass@]host:port
export function parseProxyLine(line, defaultType = 'http') {
  const t = line.trim();
  const m = t.match(/^([a-z0-9]+):\/\/(?:([^:@\/]*)(?::([^@\/]*))?@)?(\[[0-9a-fA-F:.]+\]|[^:\/@\s]+):(\d+)\/?$/i);
  if (m) {
    let type = m[1].toLowerCase(); if (type === 'socks5h') type = 'socks5';
    if (!PROXY_TYPES.includes(type)) throw new Error(`Unsupported scheme "${m[1]}"`);
    const dec = v => { try { return decodeURIComponent(v ?? ''); } catch { throw new Error('Invalid URL encoding'); } };
    return { type, host: m[4], port: m[5], username: dec(m[2]), password: dec(m[3]) };
  }
  if (t.includes('://')) throw new Error('Unrecognized format');
  const parts = t.split(':');
  if (parts.length === 2) return { type: defaultType, host: parts[0], port: parts[1], username: '', password: '' };
  if (parts.length >= 4) return { type: defaultType, host: parts[0], port: parts[1], username: parts[2], password: parts.slice(3).join(':') };
  throw new Error('Unrecognized format');
}
function maskLine(line, parsed) {
  if (!parsed?.password) return line.trim();
  const t = line.trim();
  return t.includes('://') ? t.replace(/(:\/\/[^:@\/]*:)[^@\/]*@/, '$1***@') : t.split(':').slice(0, 3).join(':') + ':***';
}
function importProxies(b) {
  const text = typeof b.text === 'string' ? b.text : null;
  if (text === null) throw err(400, 'text (string) is required');
  const defaultType = b.defaultType === undefined ? 'http' : validType(b.defaultType);
  const tags = cleanTags(b.tags);
  const lines = text.split(/\r?\n/);
  if (lines.length > 1000) throw err(400, 'at most 1000 lines per import');
  const results = []; let created = 0, duplicates = 0, failed = 0;
  lines.forEach((raw, i) => {
    if (!raw.trim() || raw.trim().startsWith('#')) return;
    let parsed = null;
    try {
      parsed = parseProxyLine(raw, defaultType);
      const type = validType(parsed.type), host = validHost(parsed.host), port = validPort(parsed.port);
      const dup = db.prepare('SELECT id FROM proxies WHERE type=? AND host=? AND port=? AND username=?').get(type, host, port, parsed.username);
      if (dup) { duplicates++; results.push({ line: i + 1, input: maskLine(raw, parsed), ok: true, id: dup.id, duplicate: true }); return; }
      const id = createProxyRow({ ...parsed, type, host, port, tags });
      created++; results.push({ line: i + 1, input: maskLine(raw, parsed), ok: true, id, duplicate: false });
    } catch (e) { failed++; results.push({ line: i + 1, input: maskLine(raw, parsed), ok: false, error: e.message }); }
  });
  return { created, duplicates, failed, results };
}

// Real request through the proxy to an IP-echo service, with classified errors.
export function classifyProxyError(e) {
  const code = e?.code || '', msg = String(e?.message || e || '');
  if (/407|auth(entication)? (failed|required)|Socks5 Authentication failed|authentication/i.test(msg) || code === 'PROXY_AUTH') return 'auth_failed';
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) return 'connect_refused';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /ENOTFOUND|EAI_AGAIN|getaddrinfo/.test(msg)) return 'dns';
  if (code === 'ETIMEDOUT' || code === 'PROXY_TIMEOUT' || /timed? ?out/i.test(msg)) return 'timeout';
  if (/socks|handshake|Parse Error|HPE_|wrong version number|packet length too long|unknown protocol|invalid response|Bad response|EPROTO|ERR_SSL/i.test(msg) || /^HPE_|^ERR_SSL|EPROTO/.test(code)) return 'protocol_unsupported';
  return 'unknown';
}
async function runProxyTest(px) {
  const timeoutMs = Number(process.env.PM_PROXY_TEST_TIMEOUT_MS || 10000);
  const auth = px.username ? `${encodeURIComponent(px.username)}:${encodeURIComponent(px.password)}@` : '';
  const host = px.host;
  const url = `${px.type}://${auth}${host}:${px.port}`; // https = TLS to the proxy itself
  const agent = px.type === 'socks5' ? new SocksProxyAgent(url, { timeout: timeoutMs }) : new HttpsProxyAgent(url, { timeout: timeoutMs, rejectUnauthorized: !proxyTestInsecureTls() });
  const target = process.env.PROXY_TEST_URL || 'https://api.ipify.org?format=json';
  const t0 = Date.now();
  // Resolve the proxy host first so DNS problems are reported as `dns` rather than a generic timeout.
  if (!/^\[|^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const dnsErr = await Promise.race([
      dns.lookup(host).then(() => null, e => e),
      new Promise(r => setTimeout(() => r(Object.assign(new Error(`DNS lookup for ${host} timed out`), { code: 'EAI_AGAIN' })), timeoutMs)),
    ]);
    if (dnsErr) return { ok: false, ip: null, error: 'dns', message: `Cannot resolve proxy host ${host}: ${dnsErr.code || dnsErr.message}`, latencyMs: Date.now() - t0 };
  }
  return await new Promise(resolve => {
    let settled = false;
    const done = v => { if (!settled) { settled = true; clearTimeout(hard); resolve({ latencyMs: Date.now() - t0, ...v }); } };
    const fail = e => { const error = classifyProxyError(e); done({ ok: false, ip: null, error, message: error === 'timeout' ? `No response from proxy within ${timeoutMs} ms` : String(e?.message || e).slice(0, 300) }); };
    const hard = setTimeout(() => { req.destroy(); fail(Object.assign(new Error('timeout'), { code: 'PROXY_TIMEOUT' })); }, timeoutMs);
    const req = (target.startsWith('https') ? https : http).get(target, { agent }, resp => {
      let body = ''; resp.on('data', d => { if (body.length < 4096) body += d; });
      resp.on('end', () => {
        if (resp.statusCode === 407) return fail(Object.assign(new Error('Proxy authentication required (407)'), { code: 'PROXY_AUTH' }));
        if (resp.statusCode >= 400) return done({ ok: false, ip: null, error: 'unknown', message: `IP lookup returned HTTP ${resp.statusCode}`, status: resp.statusCode });
        let ip = null;
        try { ip = JSON.parse(body).ip ?? null; } catch { ip = body.trim().split(/\s/)[0] || null; }
        if (ip && !/^[0-9a-fA-F:.]{3,45}$/.test(ip)) ip = null;
        done({ ok: true, ip, error: null, message: null, status: resp.statusCode });
      });
      resp.on('error', fail);
    });
    req.on('error', e => {
      // https-proxy-agent reports a non-200 CONNECT reply as a generic socket error; 407 is surfaced via the message on some versions
      fail(e);
    });
  });
}
async function testLibraryProxy(id) {
  const r = mustProxy(id);
  let password;
  try { password = decrypt(r.password); } catch (e) { throw Object.assign(err(500, 'Cannot decrypt this proxy\'s password: ' + e.message + '. Re-enter it.'), { code: e.code }); }
  const res = await runProxyTest({ type: r.type, host: r.host, port: r.port, username: r.username, password });
  db.prepare('UPDATE proxies SET last_test_status=?, last_test_ip=?, last_test_latency_ms=?, last_test_error=?, last_tested_at=? WHERE id=?')
    .run(res.ok ? 'ok' : 'failed', res.ip, res.latencyMs, res.error, new Date().toISOString(), id);
  return { ok: res.ok, ip: res.ip, latencyMs: res.latencyMs, error: res.error, message: res.message, proxy: publicProxy(proxyRow(id)) };
}
// Legacy ad-hoc test (inline proxy object, not saved)
async function testProxy(px) {
  px = cleanProxy(px);
  if (!px) throw err(400, 'no proxy configured');
  return runProxyTest(px);
}

// Routes shared by /api and /api/v1
function mountProxyRoutes(r) {
  r.get('/proxies', (req, res) => res.json(listProxies(req.query)));
  r.post('/proxies', wrap((req, res) => res.status(201).json(publicProxy(proxyRow(createProxyRow(req.body))))));
  r.post('/proxies/import', wrap((req, res) => res.json(importProxies(req.body))));
  r.get('/proxies/:id', wrap((req, res) => res.json(publicProxy(mustProxy(req.params.id)))));
  r.patch('/proxies/:id', wrap((req, res) => res.json(patchProxy(req.params.id, req.body))));
  r.delete('/proxies/:id', wrap((req, res) => { deleteProxy(req.params.id, req.query.force === '1' || req.query.force === 'true'); res.status(204).end(); }));
  r.post('/proxies/:id/test', wrap(async (req, res) => res.json(await testLibraryProxy(req.params.id))));
  r.post('/profiles/:id/proxy', wrap((req, res) => {
    if (!('proxyId' in req.body)) throw err(400, 'proxyId is required (string or null)');
    res.json(assignProxy(req.params.id, req.body.proxyId));
  }));
}
function diagnostics() {
  let browserPath = null, browserInstalled = false;
  try { browserPath = getSetting('executablePath', '') || chromium.executablePath(); browserInstalled = fs.existsSync(browserPath); } catch {}
  return {
    app: { version: process.env.PM_APP_VERSION || JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version, mode: process.versions.electron ? 'electron' : 'node' },
    versions: { node: process.versions.node, electron: process.versions.electron || null, chrome: process.versions.chrome || null },
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    dataDir: DATA_DIR, schemaVersion: currentVersion(db), migration,
    encryption: encryptionStatus(), browser: { path: browserPath, installed: browserInstalled, browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH || 'default' },
    profiles: db.prepare('SELECT COUNT(*) n FROM profiles').get().n, proxies: db.prepare('SELECT COUNT(*) n FROM proxies').get().n, running: engine.runningIds().length, pid: process.pid,
  };
}


export function createApp({ uiToken = process.env.PM_UI_TOKEN || null, staticDir = path.resolve('web/dist') } = {}) {
  const API_TOKEN = loadApiToken();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => { req.body ??= {}; next(); });

  const tokenOk = (given, expected) => { const a = Buffer.from(String(given || '')), b = Buffer.from(expected); return a.length === b.length && crypto.timingSafeEqual(a, b); };

  // --- UI API (/api). If a UI token is configured (Electron), it's required. ---
  const ui = express.Router();
  // Token is accepted ONLY via the X-UI-Token header (never the query string, which leaks into logs/history).
  if (uiToken) ui.use((req, res, next) => tokenOk(req.get('x-ui-token'), uiToken) ? next() : res.status(401).json({ error: 'unauthorized' }));
  ui.get('/profiles', (req, res) => res.json(list(req.query).map(publicP)));
  ui.get('/meta', (req, res) => {
    const all = db.prepare('SELECT tags, folder FROM profiles').all();
    res.json({ tags: [...new Set(all.flatMap(r => JSON.parse(r.tags)))].sort(), folders: [...new Set(all.map(r => r.folder))].sort(), running: engine.runningIds() });
  });
  ui.get('/profiles/:id', wrap((req, res) => res.json(publicP(must(req.params.id)))));
  ui.post('/profiles', wrap((req, res) => res.status(201).json(publicP(get(insert(validate(req.body)))))));
  ui.put('/profiles/:id', wrap(updateHandler));
  ui.post('/profiles/:id/clone', wrap((req, res) => res.status(201).json(publicP(clone(req.params.id, req.body)))));
  ui.delete('/profiles/:id', wrap(async (req, res) => { await remove(req.params.id); res.status(204).end(); }));
  ui.post('/profiles/:id/launch', wrap(async (req, res) => res.json(await doLaunch(req.params.id, req.body))));
  ui.post('/profiles/:id/stop', wrap(async (req, res) => res.json(await doStop(req.params.id))));
  mountProxyRoutes(ui);
  ui.post('/proxy/test', wrap(async (req, res) => res.json(await testProxy(req.body.proxy || req.body))));
  ui.post('/profiles/:id/test-proxy', wrap(async (req, res) => {
    const p = must(req.params.id);
    if (!p.proxy_id) throw err(400, 'no proxy configured');
    const r = await testLibraryProxy(p.proxy_id); delete r.proxy; res.json(r);
  }));
  ui.get('/settings', (req, res) => res.json(Object.fromEntries(Object.entries(SETTINGS_DEFAULTS).map(([k, d]) => [k, getSetting(k, d)]))));
  ui.put('/settings', wrap((req, res) => {
    const b = req.body;
    if ('defaultHeadless' in b) setSetting('defaultHeadless', !!b.defaultHeadless);
    if ('executablePath' in b) { const p = String(b.executablePath || '').trim(); if (p && !fs.existsSync(p)) throw err(400, `Browser executable not found: ${p}`); setSetting('executablePath', p); }
    if ('startUrl' in b) { const u = String(b.startUrl || '').trim(); if (u && !/^https?:\/\//.test(u)) throw err(400, 'startUrl must start with http:// or https://'); setSetting('startUrl', u); }
    res.json(Object.fromEntries(Object.entries(SETTINGS_DEFAULTS).map(([k, d]) => [k, getSetting(k, d)])));
  }));
  ui.get('/diagnostics', (req, res) => res.json(diagnostics()));
  ui.get('/browser', (req, res) => res.json(browserStatus()));
  ui.post('/browser/install', (req, res) => { installBrowser(); res.status(202).json(browserStatus()); });
  ui.get('/api-token', (req, res) => uiToken ? res.json({ token: API_TOKEN }) : res.status(403).json({ error: 'only available in the desktop app' }));
  // Server-sent events: profile:started / stopped / crashed / launch-failed
  ui.get('/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.flushHeaders();
    const send = e => res.write(`data: ${JSON.stringify(e)}\n\n`);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    engine.events.on('event', send);
    req.on('close', () => { clearInterval(ping); engine.events.off('event', send); });
  });

  // --- Automation API (/api/v1, token required) ---
  const v1 = express.Router();
  v1.use((req, res, next) => {
    const h = req.get('authorization') || '';
    const t = h.startsWith('Bearer ') ? h.slice(7) : req.get('x-api-key');
    tokenOk(t, API_TOKEN) ? next() : res.status(401).json({ error: 'invalid or missing API token' });
  });
  v1.get('/profiles', (req, res) => res.json(list(req.query).map(publicP)));
  v1.post('/profiles', wrap((req, res) => res.status(201).json(publicP(get(insert(validate(req.body)))))));
  v1.get('/profiles/:id', wrap((req, res) => res.json(publicP(must(req.params.id)))));
  v1.delete('/profiles/:id', wrap(async (req, res) => { await remove(req.params.id); res.status(204).end(); }));
  v1.post('/profiles/:id/clone', wrap((req, res) => res.status(201).json(publicP(clone(req.params.id, req.body)))));
  v1.put('/profiles/:id', wrap(updateHandler));
  v1.patch('/profiles/:id', wrap(updateHandler));
  v1.post('/profiles/:id/launch', wrap(async (req, res) => res.json(await doLaunch(req.params.id, req.body, { allowOverride: true }))));
  v1.post('/profiles/:id/stop', wrap(async (req, res) => res.json(await doStop(req.params.id))));
  mountProxyRoutes(v1);
  v1.get('/running', (req, res) => res.json(engine.runningIds().map(id => publicP(get(id)))));
  v1.post('/bulk/create', wrap((req, res) => {
    const items = req.body.profiles;
    if (!Array.isArray(items) || !items.length || items.length > 100) throw err(400, 'profiles must be an array of 1-100 items');
    const vals = items.map(i => validate(i || {}));
    const ids = db.transaction(() => vals.map(insert))();
    res.status(201).json(ids.map(id => publicP(get(id))));
  }));
  v1.post('/bulk/launch', wrap(async (req, res) => {
    const ids = req.body.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 50) throw err(400, 'ids must be an array of 1-50 ids');
    const out = [];
    for (const id of ids) { try { out.push({ id, ok: true, profile: await doLaunch(id, req.body) }); } catch (e) { out.push({ id, ok: false, ...errorBody(e) }); } }
    res.json(out);
  }));
  v1.post('/bulk/stop', wrap(async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : engine.runningIds();
    for (const id of ids) await engine.stop(id);
    res.json({ stopped: ids });
  }));

  app.use('/api/v1', v1);
  app.use('/api', ui);
  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));
  if (staticDir && fs.existsSync(staticDir)) { app.use(express.static(staticDir)); app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(staticDir, 'index.html'))); }
  // JSON errors for malformed bodies etc.
  app.use((e, req, res, next) => res.status(e.status || 500).json({ error: e.type === 'entity.parse.failed' ? 'invalid JSON body' : e.message }));
  return app;
}

// Start everything: recovery, secret migration, health monitor, HTTP listener.
export async function startServer({ port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1', ...appOpts } = {}) {
  const recovery = await engine.recoverAfterRestart();
  const reencrypted = reencryptSecrets();
  // Secrets were rewritten (re-encryption, or migration v6 moved inline proxies): VACUUM once so old values don't survive in free pages/WAL.
  const scrubbed = reencrypted > 0 || migration.applied.includes(6);
  if (scrubbed) scrubDatabaseFile();
  setStrictPrefixes(true); // all stored secrets are now prefixed; reject anything unprefixed from here on
  engine.startHealthMonitor();
  const app = createApp(appOpts);
  const server = await new Promise((res, rej) => { const s = app.listen(port, host, () => res(s)).on('error', rej); });
  const actual = server.address().port;
  return { server, port: actual, url: `http://${host}:${actual}`, recovery, reencrypted, scrubbed, migration, events: engine.events,
    close: async () => {
      await engine.shutdown();
      const closed = new Promise(r => server.close(() => r()));
      server.closeAllConnections?.(); // includes open SSE streams, which would otherwise keep close() pending
      await Promise.race([closed, new Promise(r => setTimeout(r, 3000))]);
    } };
}
