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
import { mountProfileDiagnostics, isProfileDiagnosticsRequest, diagnosticsHttpError, diagnosticsAuthorized } from './diagnostics.js';
import { currentVersion } from './migrations.js';
import { chromiumStatus, browsersRoot, isResourcesBrowsers } from './chromium.js';
import { executableCompatibility, installVerifiedChromiumWithBackup, interruptedInstallState, listInstallBackups } from './chromium-lifecycle.js';
import { fingerprintCapabilityReport } from './fingerprint-capabilities.js';
import { launchLimits, resourceLimitsSummary } from './launch-limits.js';
import { summarizeConsistency } from './fingerprint-summary.js';
import { buildMonitoringReport } from './monitoring-report.js';
import { computeParityCoverage } from './parity-scorecard.js';
import { privacyEngineReport } from './privacy-engine-report.js';
import { buildGoogleCompatReport } from './google-compat-report.js';
import { browserEngineArchitectureReport, browserUpdateManagerReport, browserEngineCapabilityMatrix, buildProfileConfigModel } from './browser-runtime/index.js';
import { rollbackBrowserSlot } from './browser-runtime/update-manager.js';
import { startWebDriverBridge, stopWebDriverBridge, webDriverBridgeReport } from './webdriver-bridge.js';
import { startGeckodriverBridge, stopGeckodriverBridge, geckodriverBridgeReport } from './geckodriver-bridge.js';
import {
  listWorkspaces, createWorkspace, updateWorkspace, deleteWorkspace, getWorkspace, assignProfileWorkspace,
  assertWorkspaceAccess, vaultStorageAvailable,
} from './workspaces.js';
import {
  configureCookieRobot, createCookieRobotJob, getCookieRobotJob, listCookieRobotJobs, cancelCookieRobotJob, retryCookieRobotJob, cookieRobotReport,
} from './cookie-robot-jobs.js';
import { buildProfileConfigDocument, profileConfigJsonSchema, normalizeProfileConfigInput, profileConfigWarnings } from './profile-config-engine.js';
import {
  createQuickProfile, softDeleteProfile, listTrash, restoreFromTrash, purgeFromTrash, convertQuickToRegular,
  createTemplateFromProfile, listTemplates, applyTemplate, deleteTemplate,
} from './profile-lifecycle.js';
import { startProcessSnapshotSampler } from './process-snapshot.js';
import { DEFAULT_BROWSER_SETTINGS, validateBrowserSettings } from './browser-settings.js';
import { normalizeAdvancedSettings, validateAdvancedSettings } from './advanced-settings.js';
import { buildUserAgent } from './advanced-launch.js';
import { chromiumIdentity } from './chromium-identity.js';
import { DEFAULT_WEBRTC_SETTINGS, validateWebRtcSettings } from './webrtc-policy.js';
import { clearProfileCookies, cookiesFromContext, importProfileCookies, readProfileCookies, validateClearSelection } from './cookies.js';
import {
  assertProfileStoppedForDiskExport, exportStoppedProfileBookmarks, exportStoppedProfileHistory,
} from './profile-browser-export.js';
import { focusRunningBrowserSession, locateRunningBrowserSession } from './browser-window-actions.js';
import { adbAdapterReport, listAdbDevices } from './adb-adapter.js';
import { automationDriversReport, installAutomationDrivers } from './automation-drivers.js';
import { createBackup, createEncryptedBackup, inspectBackup, restoreBackup } from './backup.js';
import { boundedConcurrency, mapPool, profilesFromCsv } from './bulk.js';
import { dashboardStats } from './dashboard.js';
import { createView, deleteView, listViews, queryProfiles, updateView } from './profile-table.js';
import { cleanupStorage, inspectStorage } from './storage.js';
import { appendJobItem, createJob, finishJob, getJob, listJobs } from './jobs.js';
import { runBatch } from './batch.js';
import { buildEndpoint, createAccount, deleteAccount, listAccounts, listWebshareProxies, providerCatalog, providerUsage } from './proxy-providers.js';
import { hostHardware, observeBrowser, UNSUPPORTED_OVERRIDES } from './hardware.js';
import { advancedLaunchPlan } from './advanced-launch.js';
import { fingerprintFindings, readPreviousObservation } from './fingerprint-consistency.js';
import { FINGERPRINT_CONTROLS, FINGERPRINT_FIXED, FINGERPRINT_REJECTED } from './fingerprint-settings.js';
import { processCommandLine } from './proc.js';
import { copyProfileTree } from './profile-copy.js';
import {
  assertKnownAssignments, assignExtension, copyExtensionAssignments, deleteExtension, importUnpackedExtension,
  listExtensions, mustExtension, profileExtensions, publicExtension, replaceProfileExtensions,
  setExtensionEnabled, unassignExtension,
} from './extensions.js';
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
  install = install || installVerifiedChromiumWithBackup;
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
const SETTINGS_DEFAULTS = {
  defaultHeadless: false,
  executablePath: '',
  firefoxExecutablePath: '',
  startUrl: '',
  maxRunningProfiles: 4,
  minFreeMemoryGiB: 1,
  maxConcurrentLaunches: 2,
  launchReservationSeconds: 120,
  automationDriversOptIn: false,
};

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
  const browserSettings = r.browser_settings ? JSON.parse(r.browser_settings) : { ...DEFAULT_BROWSER_SETTINGS, languages: [] };
  delete r.browser_settings;
  const webrtcSettings = r.webrtc_settings ? JSON.parse(r.webrtc_settings) : { ...DEFAULT_WEBRTC_SETTINGS };
  delete r.webrtc_settings;
  const extensions = profileExtensions(r.id);
  let advancedSettings = normalizeAdvancedSettings({});
  if (r.advanced_settings) { try { advancedSettings = normalizeAdvancedSettings(JSON.parse(r.advanced_settings)); } catch { /* keep defaults when the stored JSON is unreadable */ } }
  delete r.advanced_settings;
  const browserEngine = r.browser_engine === 'firefox' ? 'firefox' : 'chromium';
  delete r.browser_engine;
  const isQuick = !!r.is_quick;
  delete r.is_quick;
  const deletedAt = r.deleted_at || null;
  delete r.deleted_at;
  const workspaceId = r.workspace_id || null;
  delete r.workspace_id;
  return { ...r, browserEngine, isQuick, deletedAt, workspaceId, browserSettings, webrtcSettings, advancedSettings, extensions, tags: JSON.parse(r.tags), proxy, automationEnabled: !!r.automation_enabled, running: engine.isRunning(r.id), ...(secretError && { secretError }) };
};
const publicP = p => {
  if (!p) return p;
  const { automation_enabled, proxy_id, ...rest } = p;
  // `password` here is only a fixed mask for the legacy editor; the real value is never returned.
  const out = { ...rest, proxyId: proxy_id || null, proxy: p.proxy ? { ...p.proxy, hasPassword: !!p.proxy.password, password: p.proxy.password ? '••••' : '' } : null };
  const ri = p.running && engine.runInfo(p.id);
  if (ri) {
    out.pid = ri.pid ?? null;
    if (ri.cdp_port && p.browserEngine === 'firefox') {
      out.cdp = { marionettePort: ri.cdp_port, debuggerAddress: `127.0.0.1:${ri.cdp_port}`, automation: true, pid: ri.pid ?? null };
    } else if (ri.cdp_port) {
      out.cdp = { wsEndpoint: ri.ws_endpoint, httpEndpoint: `http://127.0.0.1:${ri.cdp_port}`, debuggerAddress: `127.0.0.1:${ri.cdp_port}`, pid: ri.pid ?? null };
    }
  }
  return out;
};
const get = id => {
  const p = row2p(db.prepare('SELECT * FROM profiles WHERE id=? AND deleted_at IS NULL').get(id));
  if (p) assertWorkspaceAccess(p.workspaceId);
  return p;
};
const getAny = id => row2p(db.prepare('SELECT * FROM profiles WHERE id=?').get(id));
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
  const browserSettings = validateBrowserSettings('browserSettings' in b ? b.browserSettings : {}, prev?.browserSettings);
  const webrtcSettings = validateWebRtcSettings('webrtcSettings' in b ? b.webrtcSettings : {}, prev?.webrtcSettings);
  const advancedSettings = validateAdvancedSettings('advancedSettings' in b ? b.advancedSettings : {}, prev?.advancedSettings);
  const extensionAssignments = 'extensionAssignments' in b ? assertKnownAssignments(b.extensionAssignments) : null;
  const tags = Array.isArray(b.tags) ? b.tags : typeof b.tags === 'string' ? b.tags.split(',') : prev?.tags || [];
  let browserEngine = prev?.browserEngine ?? 'chromium';
  if ('browserEngine' in b) {
    if (b.browserEngine !== 'chromium' && b.browserEngine !== 'firefox') throw err(400, 'browserEngine must be chromium or firefox');
    browserEngine = b.browserEngine;
  }
  let workspaceId = prev?.workspaceId ?? null;
  if ('workspaceId' in b) workspaceId = b.workspaceId == null || b.workspaceId === '' ? null : String(b.workspaceId);
  if (workspaceId) assertWorkspaceAccess(workspaceId);
  return { name, browserEngine, browserSettings, webrtcSettings, advancedSettings, extensionAssignments, tags: [...new Set(tags.map(t => String(t).trim()).filter(Boolean))],
    folder: String(b.folder ?? prev?.folder ?? '').trim(), notes: String(b.notes ?? prev?.notes ?? ''),
    workspaceId,
    proxyId: 'proxy' in b ? resolveInlineProxy(b.proxy, prev) : 'proxyId' in b ? (b.proxyId == null || b.proxyId === '' ? null : mustProxy(b.proxyId).id) : prev?.proxy_id ?? null,
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
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,proxy_id,automation_enabled,browser_engine,browser_settings,webrtc_settings,advanced_settings,is_quick,workspace_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, v.name, JSON.stringify(v.tags), v.folder, v.notes, v.proxyId, v.automationEnabled ? 1 : 0, v.browserEngine || 'chromium', JSON.stringify(v.browserSettings), JSON.stringify(v.webrtcSettings), JSON.stringify(v.advancedSettings), v.isQuick ? 1 : 0, v.workspaceId || null, now, now);
  if (v.extensionAssignments) replaceProfileExtensions(id, v.extensionAssignments);
  fs.mkdirSync(dir, { recursive: true });
  return id;
}
function list({ q = '', tag = '', folder, workspaceId } = {}) {
  let l = db.prepare('SELECT * FROM profiles WHERE deleted_at IS NULL ORDER BY created_at DESC').all().map(row2p)
    .filter(p => { try { assertWorkspaceAccess(p.workspaceId); return true; } catch { return false; } });
  if (q) { const s = String(q).toLowerCase(); l = l.filter(p => (p.name + ' ' + p.notes + ' ' + p.tags.join(' ') + ' ' + p.folder).toLowerCase().includes(s)); }
  if (tag) l = l.filter(p => p.tags.includes(tag));
  if (folder !== undefined && folder !== '__all') l = l.filter(p => p.folder === folder);
  if (workspaceId) l = l.filter(p => p.workspaceId === workspaceId);
  return l;
}
function cloneMode(body) {
  if (body.mode !== undefined && body.mode !== 'settings' && body.mode !== 'data') throw err(400, 'mode must be "settings" or "data"');
  if ('copyData' in body && typeof body.copyData !== 'boolean') throw err(400, 'copyData must be a boolean');
  const copyData = body.mode ? body.mode === 'data' : body.copyData !== false;
  if (body.mode && 'copyData' in body && copyData !== body.copyData) throw err(400, 'mode and copyData disagree');
  return copyData;
}
function clone(id, body = {}) {
  const p = must(id);
  const copyData = cloneMode(body);
  if (copyData && engine.isRunning(id)) throw err(409, `Profile "${p.name}" is running. Stop it before cloning (browser data can't be copied consistently while in use), or pass {"copyData": false} to clone settings only.`);
  const nid = insert({ ...p, proxyId: p.proxy_id || null, name: body.name || p.name + ' (copy)' });
  copyExtensionAssignments(id, nid);
  if (copyData) {
    const src = userDataDir(id);
    try { if (fs.existsSync(src)) copyProfileTree(src, userDataDir(nid)); }
    catch (e) {
      db.prepare('DELETE FROM profiles WHERE id=?').run(nid);
      fs.rmSync(userDataDir(nid), { recursive: true, force: true });
      if (e.status) throw e;
      throw err(500, 'Clone failed while copying data: ' + e.message);
    }
  }
  return get(nid);
}
async function remove(id) {
  must(id);
  await softDeleteProfile(id, { stopFn: async i => engine.stop(i) });
}
async function purgeProfile(id, confirmName) {
  await engine.stop(id).catch(() => {});
  return purgeFromTrash(id, { confirmName });
}
const headlessDefault = () => process.env.HEADLESS === '1' || getSetting('defaultHeadless', false);
const updateHandler = (req, res) => { res.json(applyUpdate(req.params.id, req.body)); };
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
configureCookieRobot({ launchProfile: id => doLaunch(id, { automation: true }, { allowOverride: true }) });

function chromiumFacts() {
  let executable = '';
  try { executable = getSetting('executablePath', '') || chromium.executablePath(); } catch { executable = getSetting('executablePath', ''); }
  const identity = chromiumIdentity(executable && fs.existsSync(executable) ? executable : '');
  const presets = {};
  if (identity.version) {
    for (const mode of ['reduced', 'full']) {
      try { presets[mode] = buildUserAgent({ version: identity.version, platform: process.platform, headless: false, mode }).userAgent; }
      catch { /* this platform has no coherent preset */ }
    }
  }
  return {
    ...identity,
    presets,
    headlessNote: 'Headless launches use HeadlessChrome with the same Chromium version. Client hints keep that full version.',
  };
}
async function hardwareReport(id, { previous = null } = {}) {
  const profile = id ? must(id) : null;
  const ctx = id && typeof engine.liveContext === 'function' ? engine.liveContext(id) : null;
  const chromium = chromiumFacts();
  let permissions = null;
  if (profile) {
    try { permissions = advancedLaunchPlan(profile.advancedSettings, { headless: false, version: chromium.version, platform: process.platform }).permissions; }
    catch { permissions = null; }
  }
  const browser = id
    ? (engine.isRunning(id) ? await observeBrowser(ctx, { permissions }) : { availability: 'unavailable', reason: 'not_running' })
    : { availability: 'unavailable', reason: 'no_profile' };
  const evidence = id && typeof engine.launchEvidence === 'function' ? engine.launchEvidence(id) : null;
  const commandLine = evidence?.browserPid ? await processCommandLine(evidence.browserPid) : null;
  const host = hostHardware();
  const consistency = fingerprintFindings({
    advanced: profile?.advancedSettings || {},
    browserSettings: profile?.browserSettings || {},
    webrtc: profile?.webrtcSettings || { mode: 'browser_default' },
    observation: browser.availability === 'observed' ? browser : null,
    commandLine,
    chromiumVersion: chromium.version,
    hostPlatform: process.platform,
    hostTimezone: host.timezone?.value || null,
    previous,
  });
  return {
    chromium,
    host,
    configured: profile ? { userAgent: profile.advancedSettings.userAgent, geolocation: profile.advancedSettings.geolocation, screen: profile.advancedSettings.screen, permissions: profile.advancedSettings.preferences.permissions, fingerprint: profile.advancedSettings.fingerprint } : null,
    browser,
    unsupported: UNSUPPORTED_OVERRIDES,
    consistency: { ...consistency, interpretation: summarizeConsistency(consistency) },
  };
}
async function cookieList(id) {
  const profile = must(id);
  if (engine.isRunning(id)) {
    const ctx = typeof engine.liveContext === 'function' ? engine.liveContext(id) : null;
    if (!ctx) throw err(409, 'This profile is running without a local browser context, so its cookies cannot be listed safely');
    return { cookies: cookiesFromContext(await ctx.cookies()) };
  }
  return { cookies: readProfileCookies(userDataDir(profile.id)) };
}
function cookieMutation(id) {
  const profile = must(id);
  if (engine.isRunning(id)) throw Object.assign(err(409, 'Stop the profile before changing its cookies. A live cookie database cannot be edited safely.'), { code: 'PROFILE_RUNNING' });
  return profile;
}
function bulkLaunch(body, allowOverride, onItem) {
  const ids = body.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 50) throw err(400, 'ids must be an array of 1-50 ids');
  const concurrency = boundedConcurrency(body.concurrency, 2);
  return mapPool(ids, concurrency, async id => {
    try { return { id, ok: true, profile: await doLaunch(id, body, { allowOverride }) }; }
    catch (error) { return { id, ok: false, ...errorBody(error) }; }
  }, onItem);
}
function bulkStop(body, onItem) {
  const ids = Array.isArray(body.ids) ? body.ids : engine.runningIds();
  if (ids.length > 50) throw err(400, 'ids must contain at most 50 ids');
  const concurrency = boundedConcurrency(body.concurrency, 4);
  return mapPool(ids, concurrency, async id => {
    try { await engine.stop(id); return { id, ok: true }; }
    catch (error) { return { id, ok: false, ...errorBody(error) }; }
  }, onItem).then(results => ({ stopped: ids, results }));
}
function bulkDelete(body, onItem) {
  const ids = body.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 50) throw err(400, 'ids must be an array of 1-50 ids');
  const concurrency = boundedConcurrency(body.concurrency, 2);
  return mapPool(ids, concurrency, async id => {
    try { await remove(id); return { id, ok: true }; }
    catch (error) { return { id, ok: false, ...errorBody(error) }; }
  }, onItem);
}
function bulkAssign(body, onItem) {
  const ids = body.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw err(400, 'ids must be an array of 1-100 ids');
  const hasFolder = 'folder' in body;
  const hasTags = 'addTags' in body || 'removeTags' in body;
  const hasProxy = 'proxyId' in body;
  if (!hasFolder && !hasTags && !hasProxy) throw err(400, 'assign a folder, tags, or proxy');
  if (hasFolder && body.folder != null && typeof body.folder !== 'string') throw err(400, 'folder must be a string');
  if (hasProxy && body.proxyId != null && body.proxyId !== '') mustProxy(body.proxyId);
  const add = cleanTags(body.addTags || []);
  const remove = new Set(cleanTags(body.removeTags || []));
  return ids.map(id => {
    try {
      const profile = must(id);
      if (hasFolder) db.prepare('UPDATE profiles SET folder=?, updated_at=? WHERE id=?').run(String(body.folder || '').trim(), new Date().toISOString(), id);
      if (hasTags) {
        const tags = [...new Set([...profile.tags.filter(tag => !remove.has(tag)), ...add])];
        db.prepare('UPDATE profiles SET tags=?, updated_at=? WHERE id=?').run(JSON.stringify(tags), new Date().toISOString(), id);
      }
      const assigned = hasProxy ? assignProxy(id, body.proxyId || null) : null;
      const item = { id, ok: true, profile: assigned || publicP(get(id)) };
      if (onItem) onItem(item);
      return item;
    } catch (error) {
      const item = { id, ok: false, ...errorBody(error) };
      if (onItem) onItem(item);
      return item;
    }
  });
}
function bulkFromTemplate(body, onItem) {
  const templateId = body.templateId;
  const count = Number(body.count);
  const prefix = String(body.namePrefix || 'From template').slice(0, 80);
  const folderOverride = 'folder' in body ? String(body.folder || '').trim() : null;
  const getSnap = row => JSON.parse(row.snapshot_json);
  return Array.from({ length: count }, (_, index) => {
    try {
      const id = applyTemplate(templateId, {
        name: `${prefix} ${index + 1}`.slice(0, 200),
        insertFn: v => insert(validate(folderOverride != null ? { ...v, folder: folderOverride } : v)),
        getTemplateSnapshot: getSnap,
      });
      const item = { index, ok: true, profile: publicP(get(id)) };
      if (onItem) onItem(item);
      return item;
    } catch (error) {
      const item = { index, ok: false, ...errorBody(error) };
      if (onItem) onItem(item);
      return item;
    }
  });
}
function bulkImport(body, onItem) {
  const items = body.format === 'csv' ? profilesFromCsv(body.csv) : body.format === 'json' || Array.isArray(body.profiles) ? body.profiles : null;
  if (!Array.isArray(items)) throw err(400, 'format must be csv or json');
  if (!items.length || items.length > 100) throw err(400, 'profiles must contain 1 to 100 items');
  return items.map((item, index) => {
    try {
      const id = insert(validate(item || {}));
      const result = { index, ok: true, profile: publicP(get(id)) };
      if (onItem) onItem(result);
      return result;
    } catch (error) {
      const result = { index, ok: false, error: error.message, code: error.code || null };
      if (onItem) onItem(result);
      return result;
    }
  });
}
function bulkPlan(body) {
  const action = body.action;
  if (action === 'launch' || action === 'delete') {
    if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 50) throw err(400, 'ids must be an array of 1-50 ids');
    boundedConcurrency(body.concurrency, 2);
    return { action, total: body.ids.length };
  }
  if (action === 'stop') {
    const ids = Array.isArray(body.ids) ? body.ids : engine.runningIds();
    if (ids.length > 50) throw err(400, 'ids must contain at most 50 ids');
    boundedConcurrency(body.concurrency, 4);
    return { action, total: ids.length };
  }
  if (action === 'assign') {
    if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 100) throw err(400, 'ids must be an array of 1-100 ids');
    return { action, total: body.ids.length };
  }
  if (action === 'import') {
    const items = body.format === 'csv' ? profilesFromCsv(body.csv) : body.format === 'json' || Array.isArray(body.profiles) ? body.profiles : null;
    if (!Array.isArray(items) || !items.length || items.length > 100) throw err(400, 'profiles must contain 1 to 100 items');
    return { action, total: items.length };
  }
  if (action === 'fromTemplate') {
    const count = Number(body.count);
    if (!body.templateId || typeof body.templateId !== 'string') throw err(400, 'templateId is required');
    if (!Number.isInteger(count) || count < 1 || count > 50) throw err(400, 'count must be an integer from 1 to 50');
    return { action, total: count };
  }
  throw err(400, 'action must be launch, stop, assign, import, delete, or fromTemplate');
}
function startBulkJob(body, allowOverride) {
  const plan = bulkPlan(body);
  const jobId = createJob(plan.action, plan.total);
  const onItem = item => appendJobItem(jobId, item);
  let run;
  try {
    run = plan.action === 'launch' ? bulkLaunch(body, allowOverride, onItem)
      : plan.action === 'stop' ? bulkStop(body, onItem)
      : plan.action === 'assign' ? bulkAssign(body, onItem)
      : plan.action === 'import' ? bulkImport(body, onItem)
      : plan.action === 'fromTemplate' ? bulkFromTemplate(body, onItem)
      : bulkDelete(body, onItem);
  } catch (error) {
    finishJob(jobId, error.message || 'failed');
    return getJob(jobId);
  }
  Promise.resolve(run).then(() => finishJob(jobId), error => finishJob(jobId, error.message || 'failed'));
  return getJob(jobId);
}
function rejectPassphraseQuery(req) {
  if (req.query && (Object.hasOwn(req.query, 'passphrase') || Object.hasOwn(req.query, 'password'))) throw err(400, 'Do not send a passphrase in the query string');
}
function applyUpdate(id, body) {
  const v = validate(body, must(id));
  db.prepare('UPDATE profiles SET name=?,tags=?,folder=?,notes=?,proxy_id=?,automation_enabled=?,browser_engine=?,browser_settings=?,webrtc_settings=?,advanced_settings=?,workspace_id=?,updated_at=? WHERE id=?')
    .run(v.name, JSON.stringify(v.tags), v.folder, v.notes, v.proxyId, v.automationEnabled ? 1 : 0, v.browserEngine || 'chromium', JSON.stringify(v.browserSettings), JSON.stringify(v.webrtcSettings), JSON.stringify(v.advancedSettings), v.workspaceId || null, new Date().toISOString(), id);
  if (v.extensionAssignments) replaceProfileExtensions(id, v.extensionAssignments);
  const result = publicP(get(id));
  if (result.running && ('browserSettings' in body || 'webrtcSettings' in body || 'advancedSettings' in body || 'extensionAssignments' in body)) result.appliesOnNextLaunch = true;
  return result;
}
function batchHandlers(allowOverride) {
  return {
    createProfile: op => { const id = insert(validate(op.body || {})); return { profile: publicP(get(id)) }; },
    updateProfile: op => ({ profile: applyUpdate(op.id, op.body || {}) }),
    deleteProfile: async op => { await remove(op.id); return { id: op.id, deleted: true }; },
    launch: async op => ({ profile: await doLaunch(op.id, op.body || {}, { allowOverride }) }),
    stop: async op => ({ profile: await doStop(op.id) }),
    assignProxy: op => ({ profile: assignProxy(op.id, 'proxyId' in op ? op.proxyId : null) }),
    clone: op => ({ profile: publicP(clone(op.id, op.body || {})) }),
  };
}
function mountProfileOps(router, { allowOverride = false } = {}) {
  router.get('/chromium-identity', wrap((req, res) => res.json(chromiumFacts())));
  router.get('/fingerprint-catalog', wrap((req, res) => res.json({ controls: FINGERPRINT_CONTROLS, fixed: FINGERPRINT_FIXED, rejected: FINGERPRINT_REJECTED.map(([surface, mode, reason]) => ({ surface, mode, reason })) })));
  router.get('/fingerprint-capabilities', wrap((req, res) => res.json(fingerprintCapabilityReport({ platform: process.platform }))));
  router.get('/privacy-engine', wrap((req, res) => res.json(privacyEngineReport({ platform: process.platform }))));
  router.get('/google-compat/report', wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await buildGoogleCompatReport({ profileId: req.query.profileId || null, probe: req.query.probe === '1' }));
  }));
  router.post('/google-compat/report', express.json(), wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    res.json(await buildGoogleCompatReport({ profileId: body.profileId || null, probe: !!body.probe }));
  }));
  router.get('/browser-engine/architecture', wrap((req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(browserEngineArchitectureReport());
  }));
  router.get('/browser-engine/capability-matrix', wrap((req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(browserEngineCapabilityMatrix());
  }));
  router.get('/browser-engine/update-manager', wrap((req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(browserUpdateManagerReport());
  }));
  router.get('/webdriver', wrap((req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(webDriverBridgeReport());
  }));
  router.post('/profiles/:id/webdriver/start', wrap(async (req, res) => {
    const p = must(req.params.id);
    if (p.browserEngine === 'firefox') throw err(409, 'ChromeDriver bridge is Chromium-only. Use POST /profiles/:id/geckodriver/start for Firefox marionette sessions.');
    const row = engine.runInfo(req.params.id);
    if (!row?.cdp_port) throw err(409, 'WebDriver bridge requires a running automation session (CDP port). Manual native launches cannot attach.');
    res.json(await startWebDriverBridge(req.params.id, `127.0.0.1:${row.cdp_port}`));
  }));
  router.get('/geckodriver', wrap((req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(geckodriverBridgeReport());
  }));
  router.post('/profiles/:id/geckodriver/start', wrap(async (req, res) => {
    const p = must(req.params.id);
    if (p.browserEngine !== 'firefox') throw err(409, 'Geckodriver bridge is Firefox-only.');
    const row = engine.runInfo(req.params.id);
    if (!row?.cdp_port) throw err(409, 'Geckodriver requires Firefox running with automation (-marionette).');
    res.json(await startGeckodriverBridge(req.params.id, row.cdp_port));
  }));
  router.post('/profiles/:id/geckodriver/stop', wrap((req, res) => {
    must(req.params.id);
    res.json(stopGeckodriverBridge(req.params.id));
  }));
  router.post('/profiles/:id/webdriver/stop', wrap((req, res) => {
    must(req.params.id);
    res.json(stopWebDriverBridge(req.params.id));
  }));
  router.get('/profiles/:id/browser-config', wrap((req, res) => {
    res.set('Cache-Control', 'no-store');
    const profile = get(req.params.id);
    if (!profile) throw err(404, 'Profile not found');
    res.json(buildProfileConfigDocument(profile));
  }));
  router.get('/profile-config/schema', wrap((req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(profileConfigJsonSchema());
  }));
  router.post('/profile-config/validate', express.json(), wrap((req, res) => {
    res.set('Cache-Control', 'no-store');
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const config = normalizeProfileConfigInput(body, body);
    res.json({ valid: true, config, warnings: profileConfigWarnings(config) });
  }));
  router.get('/parity-scorecard', wrap((req, res) => res.json(computeParityCoverage())));
  router.get('/hardware', wrap(async (req, res) => res.json(await hardwareReport(null))));
  router.get('/profiles/:id/hardware', wrap(async (req, res) => res.json(await hardwareReport(req.params.id))));
  router.get('/profiles/:id/fingerprint-consistency', wrap(async (req, res) => res.json((await hardwareReport(req.params.id)).consistency)));
  router.post('/profiles/:id/fingerprint-consistency', wrap(async (req, res) => res.json((await hardwareReport(req.params.id, { previous: readPreviousObservation(req.body) })).consistency)));
  router.get('/profiles/:id/cookies', wrap(async (req, res) => res.json(await cookieList(req.params.id))));
  router.get('/profiles/:id/bookmarks/export', wrap((req, res) => {
    const profile = must(req.params.id);
    assertProfileStoppedForDiskExport(engine.isRunning, profile.id);
    res.set('Cache-Control', 'no-store');
    res.json(exportStoppedProfileBookmarks(userDataDir(profile.id)));
  }));
  router.get('/profiles/:id/history/export', wrap((req, res) => {
    const profile = must(req.params.id);
    assertProfileStoppedForDiskExport(engine.isRunning, profile.id);
    const limit = req.query.limit != null ? Number(req.query.limit) : 500;
    res.set('Cache-Control', 'no-store');
    res.json(exportStoppedProfileHistory(userDataDir(profile.id), { limit }));
  }));
  router.post('/profiles/:id/browser/focus', wrap(async (req, res) => {
    must(req.params.id);
    if (!engine.isRunning(req.params.id)) throw err(409, 'Profile is not running.', 'NOT_RUNNING');
    const row = engine.runInfo(req.params.id);
    res.json(await focusRunningBrowserSession({ pid: row?.pid ?? null, cdpPort: row?.cdp_port ?? null }));
  }));
  router.get('/profiles/:id/browser/locate', wrap(async (req, res) => {
    must(req.params.id);
    if (!engine.isRunning(req.params.id)) throw err(409, 'Profile is not running.', 'NOT_RUNNING');
    const row = engine.runInfo(req.params.id);
    res.json(await locateRunningBrowserSession({ pid: row?.pid ?? null, cdpPort: row?.cdp_port ?? null }));
  }));
  router.get('/adb', wrap((req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(adbAdapterReport());
  }));
  router.get('/adb/devices', wrap((req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(listAdbDevices());
  }));
  router.get('/automation-drivers', wrap((req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(automationDriversReport());
  }));
  router.post('/automation-drivers/install', wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const which = req.body?.driver === 'chromedriver' || req.body?.driver === 'geckodriver' ? req.body.driver : 'both';
    res.json(await installAutomationDrivers(which, { confirm: !!req.body?.confirm }));
  }));
  router.post('/profiles/:id/cookies/import', wrap((req, res) => {
    const profile = cookieMutation(req.params.id);
    const cookies = Array.isArray(req.body) ? req.body : req.body.cookies;
    res.json(importProfileCookies(userDataDir(profile.id), cookies));
  }));
  router.post('/profiles/:id/cookies/clear', wrap((req, res) => {
    const profile = cookieMutation(req.params.id);
    if (req.body.confirm === 'clear-all') return res.json(clearProfileCookies(userDataDir(profile.id), { all: true }));
    if (req.body.confirm === 'clear-selected') return res.json(clearProfileCookies(userDataDir(profile.id), { selected: validateClearSelection(req.body.cookies) }));
    throw err(400, 'confirm must be clear-all or clear-selected');
  }));
  router.post('/backup', wrap((req, res) => {
    rejectPassphraseQuery(req);
    const encrypting = req.body?.encrypt === true;
    if (!encrypting && req.body?.passphrase) throw err(400, 'Passphrase was set without encrypt:true');
    const body = encrypting ? createEncryptedBackup(req.body.passphrase) : createBackup();
    const filename = encrypting ? 'profile-manager-backup.pmbe' : 'profile-manager-backup.pmb';
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store', 'X-Backup-Contains': 'proxy-secrets', 'X-Backup-Encrypted': encrypting ? 'aes-256-gcm' : 'none' });
    res.send(body);
  }));
  router.post('/backup/inspect', express.raw({ limit: '64mb', type: () => true }), wrap((req, res) => {
    rejectPassphraseQuery(req);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw err(400, 'backup body is required');
    res.json(inspectBackup(req.body, { passphrase: req.get('x-backup-passphrase') || undefined }));
  }));
  router.post('/backup/restore', express.raw({ limit: '64mb', type: () => true }), wrap((req, res) => {
    rejectPassphraseQuery(req);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw err(400, 'backup body is required');
    res.json(restoreBackup(req.body, { collision: String(req.query.collision || 'abort'), passphrase: req.get('x-backup-passphrase') || undefined }));
  }));
  router.post('/bulk/jobs', wrap((req, res) => res.status(202).json(startBulkJob(req.body, allowOverride))));
  router.get('/bulk/jobs', wrap((req, res) => res.json(listJobs(req.query.limit))));
  router.get('/bulk/jobs/:id', wrap((req, res) => res.json(getJob(req.params.id))));
  router.post('/batch', wrap(async (req, res) => {
    const outcome = await runBatch(req.body?.operations, batchHandlers(allowOverride));
    if (req.body?.track === true) {
      const jobId = createJob('batch', outcome.results.length);
      for (const item of outcome.results) appendJobItem(jobId, item);
      finishJob(jobId, outcome.ok ? null : 'one or more operations failed');
      outcome.jobId = jobId;
    }
    res.status(outcome.ok ? 200 : 207).json(outcome);
  }));
  router.post('/bulk/import', wrap((req, res) => res.json(bulkImport(req.body))));
  router.post('/bulk/launch', wrap(async (req, res) => res.json(await bulkLaunch(req.body, allowOverride))));
  router.post('/bulk/stop', wrap(async (req, res) => res.json(await bulkStop(req.body))));
  router.post('/bulk/assign', wrap((req, res) => res.json(bulkAssign(req.body))));
}

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
function createProxyRow({ name, type, host, port, username = '', password = '', tags = [], provider = null, providerRef = null, providerMeta = {} }) {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  type = validType(type); host = validHost(host); port = validPort(port);
  name = String(name || '').trim() || `${type}://${host}:${port}`;
  if (name.length > 200) throw err(400, 'name too long');
  db.prepare('INSERT INTO proxies (id,name,type,host,port,username,password,tags,provider,provider_ref,provider_meta,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, name, type, host, port, String(username || ''), encrypt(String(password || '')), JSON.stringify(cleanTags(tags)), provider, providerRef, JSON.stringify(providerMeta || {}), now, now);
  return id;
}
const proxyRow = id => db.prepare('SELECT * FROM proxies WHERE id=?').get(id);
const mustProxy = id => { const r = proxyRow(id); if (!r) throw err(404, 'proxy not found'); return r; };
function safeProviderMeta(raw) {
  let parsed = {};
  try { parsed = JSON.parse(raw || '{}'); } catch { parsed = {}; }
  const out = {};
  for (const [key, value] of Object.entries(parsed || {})) {
    if (/password|passphrase|secret|token|authorization|api[-_]?key/i.test(key)) continue;
    if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}
function publicProxy(r) {
  if (!r) return r;
  return { id: r.id, name: r.name, type: r.type, host: r.host, port: r.port, username: r.username, hasPassword: !!r.password, tags: JSON.parse(r.tags),
    provider: r.provider || null, providerRef: r.provider_ref || null, providerMeta: safeProviderMeta(r.provider_meta),
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
  const testedAt = new Date().toISOString();
  db.prepare('UPDATE proxies SET last_test_status=?, last_test_ip=?, last_test_latency_ms=?, last_test_error=?, last_tested_at=? WHERE id=?')
    .run(res.ok ? 'ok' : 'failed', res.ip, res.latencyMs, res.error, testedAt, id);
  db.prepare('INSERT INTO proxy_checks (proxy_id, status, latency_ms, error, tested_at) VALUES (?,?,?,?,?)').run(id, res.ok ? 'ok' : 'failed', res.latencyMs, res.error, testedAt);
  db.prepare('DELETE FROM proxy_checks WHERE proxy_id=? AND id NOT IN (SELECT id FROM proxy_checks WHERE proxy_id=? ORDER BY id DESC LIMIT 50)').run(id, id);
  return { ok: res.ok, ip: res.ip, latencyMs: res.latencyMs, error: res.error, message: res.message, proxy: publicProxy(proxyRow(id)) };
}
// Legacy ad-hoc test (inline proxy object, not saved)
async function testProxy(px) {
  px = cleanProxy(px);
  if (!px) throw err(400, 'no proxy configured');
  return runProxyTest(px);
}

// Routes shared by /api and /api/v1
function mountExtensionRoutes(r) {
  r.get('/extensions', (req, res) => res.json(listExtensions()));
  r.post('/extensions/import', wrap((req, res) => res.status(201).json(importUnpackedExtension(req.body?.path ?? req.body?.sourcePath))));
  r.get('/extensions/:id', wrap((req, res) => res.json(publicExtension(mustExtension(req.params.id)))));
  r.delete('/extensions/:id', wrap((req, res) => {
    deleteExtension(req.params.id, req.query.force === '1' || req.query.force === 'true');
    res.status(204).end();
  }));
  r.post('/profiles/:id/extensions', wrap((req, res) => {
    const p = must(req.params.id);
    if (!req.body || typeof req.body.extensionId !== 'string') throw err(400, 'extensionId is required');
    const enabled = 'enabled' in req.body ? req.body.enabled : true;
    if (typeof enabled !== 'boolean') throw err(400, 'enabled must be a boolean');
    assignExtension(p.id, req.body.extensionId, enabled);
    const out = publicP(get(p.id));
    if (p.running) out.appliesOnNextLaunch = true;
    res.status(201).json(out);
  }));
  r.patch('/profiles/:id/extensions/:extensionId', wrap((req, res) => {
    const p = must(req.params.id);
    if (!req.body || !('enabled' in req.body)) throw err(400, 'enabled is required');
    setExtensionEnabled(p.id, req.params.extensionId, req.body.enabled);
    const out = publicP(get(p.id));
    if (p.running) out.appliesOnNextLaunch = true;
    res.json(out);
  }));
  r.delete('/profiles/:id/extensions/:extensionId', wrap((req, res) => {
    const p = must(req.params.id);
    unassignExtension(p.id, req.params.extensionId);
    const out = publicP(get(p.id));
    if (p.running) out.appliesOnNextLaunch = true;
    res.json(out);
  }));
}
function mountProxyRoutes(r) {
  r.get('/proxies', (req, res) => res.json(listProxies(req.query)));
  r.post('/proxies', wrap((req, res) => res.status(201).json(publicProxy(proxyRow(createProxyRow(req.body))))));
  r.post('/proxies/import', wrap((req, res) => res.json(importProxies(req.body))));
  r.get('/proxies/:id', wrap((req, res) => res.json(publicProxy(mustProxy(req.params.id)))));
  r.patch('/proxies/:id', wrap((req, res) => res.json(patchProxy(req.params.id, req.body))));
  r.delete('/proxies/:id', wrap((req, res) => { deleteProxy(req.params.id, req.query.force === '1' || req.query.force === 'true'); res.status(204).end(); }));
  r.post('/proxies/:id/test', wrap(async (req, res) => res.json(await testLibraryProxy(req.params.id))));
  r.get('/proxies/:id/checks', wrap((req, res) => {
    mustProxy(req.params.id);
    res.json(db.prepare('SELECT status, latency_ms AS latencyMs, error, tested_at AS testedAt FROM proxy_checks WHERE proxy_id=? ORDER BY tested_at ASC, id ASC').all(req.params.id));
  }));
  r.post('/profiles/:id/proxy', wrap((req, res) => {
    if (!('proxyId' in req.body)) throw err(400, 'proxyId is required (string or null)');
    res.json(assignProxy(req.params.id, req.body.proxyId));
  }));
}
function mountWorkspace(router) {
  router.get('/workspaces/vault-status', wrap((req, res) => res.json({ vaultStorageAvailable: vaultStorageAvailable(), backend: encryptionStatus().backend })));
  router.get('/workspaces', wrap((req, res) => res.json(listWorkspaces())));
  router.post('/workspaces', wrap((req, res) => res.status(201).json(createWorkspace(req.body || {}))));
  router.patch('/workspaces/:id', wrap((req, res) => res.json(updateWorkspace(req.params.id, req.body || {}))));
  router.delete('/workspaces/:id', wrap((req, res) => { deleteWorkspace(req.params.id); res.status(204).end(); }));
  router.post('/profiles/:id/workspace', wrap((req, res) => {
    must(req.params.id);
    assignProfileWorkspace(req.params.id, req.body?.workspaceId ?? null);
    res.json(publicP(get(req.params.id)));
  }));
  router.get('/cookie-robot', wrap((req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(cookieRobotReport());
  }));
  router.post('/cookie-robot/jobs', wrap((req, res) => {
    const profileId = req.body?.profileId;
    if (!profileId) throw err(400, 'profileId is required');
    must(profileId);
    res.status(202).json(createCookieRobotJob({ profileId, urls: req.body?.urls, delayMs: req.body?.delayMs }));
  }));
  router.get('/cookie-robot/jobs', wrap((req, res) => res.json(listCookieRobotJobs(req.query.limit))));
  router.get('/cookie-robot/jobs/:id', wrap((req, res) => res.json(getCookieRobotJob(req.params.id))));
  router.post('/cookie-robot/jobs/:id/cancel', wrap((req, res) => res.json(cancelCookieRobotJob(req.params.id))));
  router.post('/cookie-robot/jobs/:id/retry', wrap((req, res) => res.json(retryCookieRobotJob(req.params.id, { failedOnly: !!req.body?.failedOnly }))));
  router.get('/dashboard', wrap((req, res) => res.json(dashboardStats())));
  router.get('/profile-table', wrap((req, res) => {
    const query = { ...req.query };
    if (!('folder' in req.query)) query.folder = '__all';
    const rows = list({ q: query.q, tag: query.tag, folder: query.folder }).map(publicP);
    res.json(queryProfiles(rows, query));
  }));
  router.get('/views', wrap((req, res) => res.json(listViews(req.query.surface || 'profiles'))));
  router.post('/views', wrap((req, res) => res.status(201).json(createView(req.body))));
  router.patch('/views/:id', wrap((req, res) => res.json(updateView(req.params.id, req.body))));
  router.delete('/views/:id', wrap((req, res) => { deleteView(req.params.id); res.status(204).end(); }));
  router.get('/profiles/:id/storage', wrap((req, res) => { must(req.params.id); res.json(inspectStorage(req.params.id)); }));
  router.post('/profiles/:id/storage/cleanup', wrap((req, res) => { must(req.params.id); res.json(cleanupStorage(req.params.id, req.body)); }));
}
function mountProviderRoutes(router) {
  router.get('/proxy-providers', wrap((req, res) => res.json(providerCatalog())));
  router.get('/proxy-providers/accounts', wrap((req, res) => res.json(listAccounts())));
  router.post('/proxy-providers/accounts', wrap((req, res) => res.status(201).json(createAccount(req.body || {}))));
  router.delete('/proxy-providers/accounts/:id', wrap((req, res) => { deleteAccount(req.params.id); res.status(204).end(); }));
  router.post('/proxy-providers/accounts/:id/materialize', wrap((req, res) => {
    const built = buildEndpoint(req.params.id, req.body || {});
    const id = createProxyRow(built);
    res.status(201).json(publicProxy(proxyRow(id)));
  }));
  router.post('/proxy-providers/accounts/:id/rotate', wrap((req, res) => {
    if (!req.body || typeof req.body.proxyId !== 'string') throw err(400, 'proxyId is required');
    const built = buildEndpoint(req.params.id, req.body);
    patchProxy(req.body.proxyId, { username: built.username });
    db.prepare('UPDATE proxies SET provider=?, provider_ref=?, provider_meta=?, updated_at=? WHERE id=?')
      .run(built.provider, built.providerRef, JSON.stringify(built.providerMeta), new Date().toISOString(), req.body.proxyId);
    res.json(publicProxy(proxyRow(req.body.proxyId)));
  }));
  router.post('/proxy-providers/accounts/:id/usage', wrap(async (req, res) => res.json(await providerUsage(req.params.id))));
  router.post('/proxy-providers/accounts/:id/import', wrap(async (req, res) => {
    const items = await listWebshareProxies(req.params.id, { mode: req.body?.mode || 'direct', pages: req.body?.pages || 1 });
    const results = items.map(item => {
      try {
        const existing = item.providerRef ? db.prepare('SELECT id FROM proxies WHERE provider=? AND provider_ref=?').get(item.provider, item.providerRef) : null;
        if (existing) {
          db.prepare('UPDATE proxies SET provider_meta=?, updated_at=? WHERE id=?').run(JSON.stringify(item.providerMeta), new Date().toISOString(), existing.id);
          return { ok: true, id: existing.id, duplicate: true, host: item.host, port: item.port, valid: item.providerMeta.valid };
        }
        const id = createProxyRow({ ...item, tags: ['webshare'] });
        return { ok: true, id, duplicate: false, host: item.host, port: item.port, valid: item.providerMeta.valid };
      } catch (error) {
        return { ok: false, host: item.host, port: item.port, error: error.message, code: error.code || null };
      }
    });
    res.json({ created: results.filter(item => item.ok && !item.duplicate).length, duplicates: results.filter(item => item.duplicate).length, failed: results.filter(item => !item.ok).length, results });
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
    launchLimits: resourceLimitsSummary({ runningCount: engine.runningIds().length, queuePending: engine.pendingLaunchCount?.() ?? 0 }),
    resources: typeof engine.resourceSnapshot === 'function' ? engine.resourceSnapshot() : null,
    browserCompatibility: executableCompatibility(browserPath && browserInstalled ? browserPath : ''),
  };
}


export function createApp({ uiToken = process.env.PM_UI_TOKEN || null, staticDir = path.resolve('web/dist') } = {}) {
  const API_TOKEN = loadApiToken();
  const app = express();
  app.disable('x-powered-by');
  // Diagnostics authentication precedes body parsing, including malformed JSON.
  app.use((req, res, next) => {
    if (!isProfileDiagnosticsRequest(req)) return next();
    res.set('Cache-Control', 'no-store');
    if (diagnosticsAuthorized(req, { uiToken, apiToken: API_TOKEN, tokenOk })) return next();
    const { status, body } = diagnosticsHttpError('UNAUTHORIZED');
    return res.status(status).json(body);
  });
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => { req.body ??= {}; next(); });

  const tokenOk = (given, expected) => { const a = Buffer.from(String(given || '')), b = Buffer.from(expected); return a.length === b.length && crypto.timingSafeEqual(a, b); };

  // --- UI API (/api). If a UI token is configured (Electron), it's required. ---
  const ui = express.Router();
  // Token is accepted ONLY via the X-UI-Token header (never the query string, which leaks into logs/history).
  if (uiToken) ui.use((req, res, next) => tokenOk(req.get('x-ui-token'), uiToken) ? next() : res.status(401).json({ error: 'unauthorized' }));
  ui.get('/profiles', (req, res) => res.json(list(req.query).map(publicP)));
  ui.get('/meta', (req, res) => {
    const all = db.prepare('SELECT tags, folder FROM profiles WHERE deleted_at IS NULL').all();
    res.json({ tags: [...new Set(all.flatMap(r => JSON.parse(r.tags)))].sort(), folders: [...new Set(all.map(r => r.folder))].sort(), running: engine.runningIds() });
  });
  ui.post('/profiles/quick', wrap((req, res) => {
    const id = createQuickProfile({ name: req.body?.name, folder: req.body?.folder, insertFn: v => insert({ ...validate(v), isQuick: true }) });
    res.status(201).json(publicP(get(id)));
  }));
  ui.post('/profiles/:id/save-regular', wrap((req, res) => { must(req.params.id); convertQuickToRegular(req.params.id); res.json(publicP(get(req.params.id))); }));
  ui.get('/trash', wrap((req, res) => res.json(listTrash(row2p).map(publicP))));
  ui.post('/trash/:id/restore', wrap((req, res) => { restoreFromTrash(req.params.id); res.json(publicP(get(req.params.id))); }));
  ui.delete('/trash/:id', wrap(async (req, res) => {
    const confirmName = req.query.confirmName || req.body?.confirmName;
    res.json(await purgeProfile(req.params.id, confirmName));
  }));
  ui.get('/templates', wrap((req, res) => res.json(listTemplates())));
  ui.post('/templates', wrap((req, res) => {
    const profileId = req.body?.profileId;
    if (!profileId) throw err(400, 'profileId is required');
    res.status(201).json(createTemplateFromProfile(profileId, { name: req.body?.name, getProfile: id => get(id) }));
  }));
  ui.post('/profiles/from-template/:templateId', wrap((req, res) => {
    const id = applyTemplate(req.params.templateId, {
      name: req.body?.name,
      insertFn: v => insert(validate(v)),
      getTemplateSnapshot: row => JSON.parse(row.snapshot_json),
    });
    res.status(201).json(publicP(get(id)));
  }));
  ui.delete('/templates/:id', wrap((req, res) => { deleteTemplate(req.params.id); res.status(204).end(); }));
  ui.get('/profiles/:id', wrap((req, res) => res.json(publicP(must(req.params.id)))));
  ui.post('/profiles', wrap((req, res) => res.status(201).json(publicP(get(insert(validate(req.body)))))));
  ui.put('/profiles/:id', wrap(updateHandler));
  ui.post('/profiles/:id/clone', wrap((req, res) => res.status(201).json(publicP(clone(req.params.id, req.body)))));
  ui.delete('/profiles/:id', wrap(async (req, res) => { await remove(req.params.id); res.status(204).end(); }));
  ui.post('/profiles/:id/launch', wrap(async (req, res) => res.json(await doLaunch(req.params.id, req.body))));
  ui.post('/profiles/:id/launch/cancel', wrap(async (req, res) => res.json(engine.cancelLaunch(req.params.id))));
  ui.get('/profiles/:id/launch-status', wrap(async (req, res) => { must(req.params.id); res.json(engine.launchStatus(req.params.id)); }));
  ui.get('/resources', wrap((req, res) => res.json(engine.resourceSnapshot())));
  ui.get('/monitoring', wrap(async (req, res) => {
    res.json(await buildMonitoringReport(engine.monitoringSessions(), { refresh: req.query.refresh !== '0' }));
  }));
  ui.get('/recovery-status', wrap((req, res) => res.json({
    ...engine.recoveryStatus(),
    chromium: {
      chromium: interruptedInstallState('chromium'),
      'chromium-headless-shell': interruptedInstallState('chromium-headless-shell'),
    },
  })));
  ui.post('/profiles/:id/stop', wrap(async (req, res) => res.json(await doStop(req.params.id))));
  mountProxyRoutes(ui);
  mountExtensionRoutes(ui);
  mountProfileOps(ui);
  mountWorkspace(ui);
  mountProviderRoutes(ui);
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
    if ('firefoxExecutablePath' in b) { const p = String(b.firefoxExecutablePath || '').trim(); if (p && !fs.existsSync(p)) throw err(400, `Firefox executable not found: ${p}`); setSetting('firefoxExecutablePath', p); }
    if ('startUrl' in b) { const u = String(b.startUrl || '').trim(); if (u && !/^https?:\/\//.test(u)) throw err(400, 'startUrl must start with http:// or https://'); setSetting('startUrl', u); }
    if ('maxRunningProfiles' in b) {
      const n = Number(b.maxRunningProfiles);
      if (!Number.isInteger(n) || n < 1 || n > 8) throw err(400, 'maxRunningProfiles must be an integer from 1 to 8');
      setSetting('maxRunningProfiles', n);
    }
    if ('minFreeMemoryGiB' in b) {
      const n = Number(b.minFreeMemoryGiB);
      if (!Number.isInteger(n) || n < 0 || n > 4) throw err(400, 'minFreeMemoryGiB must be an integer from 0 to 4');
      setSetting('minFreeMemoryGiB', n);
    }
    if ('maxConcurrentLaunches' in b) {
      const n = Number(b.maxConcurrentLaunches);
      if (!Number.isInteger(n) || n < 1 || n > 4) throw err(400, 'maxConcurrentLaunches must be an integer from 1 to 4');
      setSetting('maxConcurrentLaunches', n);
    }
    if ('launchReservationSeconds' in b) {
      const n = Number(b.launchReservationSeconds);
      if (!Number.isInteger(n) || n < 30 || n > 600) throw err(400, 'launchReservationSeconds must be an integer from 30 to 600');
      setSetting('launchReservationSeconds', n);
    }
    if ('automationDriversOptIn' in b) setSetting('automationDriversOptIn', !!b.automationDriversOptIn);
    res.json(Object.fromEntries(Object.entries(SETTINGS_DEFAULTS).map(([k, d]) => [k, getSetting(k, d)])));
  }));
  ui.get('/diagnostics', (req, res) => res.json(diagnostics()));
  ui.get('/browser', (req, res) => res.json(browserStatus()));
  ui.get('/browser/compatibility', wrap((req, res) => {
    let pathValue = getSetting('executablePath', '');
    if (!pathValue) { try { pathValue = chromium.executablePath(); } catch {} }
    res.json(executableCompatibility(pathValue && fs.existsSync(pathValue) ? pathValue : ''));
  }));
  ui.get('/browser/backups', wrap((req, res) => res.json({ chromium: listInstallBackups('chromium'), 'chromium-headless-shell': listInstallBackups('chromium-headless-shell') })));
  ui.post('/browser/rollback', wrap((req, res) => {
    res.json(rollbackBrowserSlot(req.body?.name));
  }));
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
  v1.post('/profiles/:id/launch/cancel', wrap(async (req, res) => res.json(engine.cancelLaunch(req.params.id))));
  v1.get('/profiles/:id/launch-status', wrap(async (req, res) => { must(req.params.id); res.json(engine.launchStatus(req.params.id)); }));
  v1.get('/resources', wrap((req, res) => res.json(engine.resourceSnapshot())));
  v1.get('/monitoring', wrap(async (req, res) => {
    res.json(await buildMonitoringReport(engine.monitoringSessions(), { refresh: req.query.refresh !== '0' }));
  }));
  v1.get('/recovery-status', wrap((req, res) => res.json({
    ...engine.recoveryStatus(),
    chromium: {
      chromium: interruptedInstallState('chromium'),
      'chromium-headless-shell': interruptedInstallState('chromium-headless-shell'),
    },
  })));
  v1.post('/profiles/:id/stop', wrap(async (req, res) => res.json(await doStop(req.params.id))));
  mountProxyRoutes(v1);
  mountExtensionRoutes(v1);
  mountProfileOps(v1, { allowOverride: true });
  mountWorkspace(v1);
  mountProviderRoutes(v1);
  v1.get('/running', (req, res) => res.json(engine.runningIds().map(id => publicP(get(id)))));
  v1.post('/bulk/create', wrap((req, res) => {
    const items = req.body.profiles;
    if (!Array.isArray(items) || !items.length || items.length > 100) throw err(400, 'profiles must be an array of 1-100 items');
    const vals = items.map(i => validate(i || {}));
    const ids = db.transaction(() => vals.map(insert))();
    res.status(201).json(ids.map(id => publicP(get(id))));
  }));

  mountProfileDiagnostics(app, {
    uiToken, apiToken: API_TOKEN, tokenOk,
    // Existence only. Do not decrypt proxy secrets for a diagnostic read.
    loadProfile: id => db.prepare('SELECT id FROM profiles WHERE id=?').get(id) || null,
  });
  app.use('/api/v1', v1);
  app.use('/api', ui);
  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));
  if (staticDir && fs.existsSync(staticDir)) { app.use(express.static(staticDir)); app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(staticDir, 'index.html'))); }
  // JSON errors for malformed bodies etc.
  app.use((e, req, res, next) => {
    if (isProfileDiagnosticsRequest(req)) {
      const { status, body } = diagnosticsHttpError(e.type === 'entity.parse.failed' || e.status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR');
      res.set('Cache-Control', 'no-store');
      return res.status(status).json(body);
    }
    res.status(e.status || 500).json({ error: e.type === 'entity.parse.failed' ? 'invalid JSON body' : e.message });
  });
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
  const stopSampler = startProcessSnapshotSampler(Number(process.env.PM_PROCESS_SAMPLE_MS || 4000));
  const app = createApp(appOpts);
  const server = await new Promise((res, rej) => { const s = app.listen(port, host, () => res(s)).on('error', rej); });
  const actual = server.address().port;
  return { server, port: actual, url: `http://${host}:${actual}`, recovery, reencrypted, scrubbed, migration, events: engine.events,
    close: async () => {
      stopSampler?.();
      await engine.shutdown();
      const closed = new Promise(r => server.close(() => r()));
      server.closeAllConnections?.(); // includes open SSE streams, which would otherwise keep close() pending
      await Promise.race([closed, new Promise(r => setTimeout(r, 3000))]);
    } };
}
