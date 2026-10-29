import { browserContextSettings, validateBrowserSettings } from './browser-settings.js';
import { chromiumPolicyArgs, validateWebRtcSettings } from './webrtc-policy.js';
import { applyWebRtcPreference, verifyWebRtcLaunchArgs } from './webrtc-settings.js';
import { advancedLaunchPlan, applyAdvancedPreferences, applyDocumentPermissions, installUserAgent } from './advanced-launch.js';
import { verifyFingerprintLaunchArgs } from './fingerprint-settings.js';
import { executableCompatibility } from './chromium-lifecycle.js';
import { assertLaunchResources } from './launch-limits.js';
import { classifyLaunchError } from './launch-errors.js';
import { beginLaunchMetrics, finalizeLaunchMetrics, getLaunchMetrics, markBrowserReady, markContextReady } from './launch-metrics.js';
import { runWithLaunchQueue, launchQueueState, pendingLaunchCount } from './launch-queue.js';
export { pendingLaunchCount };
import { hostResourceSample, profileResourceRows } from './resource-monitor.js';
import { recoverySnapshot, sweepAbandonedLocks } from './crash-recovery.js';
import { chromiumIdentity } from './chromium-identity.js';
import { extensionLaunchPlan } from './extensions.js';
import { installRegionalLocale } from './regional-locale.js';
// Browser engine: launch/stop with per-profile locks, persisted running state, startup recovery,
// crash detection (health monitor), safe shutdown, a local proxy relay and (opt-in) CDP endpoints.
// The remote-debugging port is OFF unless the launch option `automation` is truthy: an open CDP port
// gives any local process full control of the session.
import fs from 'fs';
import { diagnosticProcessStart, observeProcessPolicy } from './diagnostic-process.js';
export { summarizeWebRtcArguments } from './diagnostic-process.js';
import { randomUUID } from 'crypto';
import { readPreferences, observePreferences, captureTermination, waitForTermination, processCorrelation } from './termination-evidence.js';
import net from 'net';
import path from 'path';
import { EventEmitter } from 'events';
import { chromium } from 'playwright';
import { anonymizeProxy, closeAnonymizedProxy } from 'proxy-chain';
import { db, userDataDir, getSetting } from './db.js';
import { acquireLock, releaseLock, updateLock, readLock, isStale, LOCK_NAME } from './lock.js';
import { isAlive, killTree, pidMatches, processParents } from './proc.js';
import { chromiumMissingError } from './chromium.js';
import { automationDefault, proxyLoopback, isPackaged } from './testflags.js';
import { chooseLaunchUrls, readSavedTabs, snapshotTabUrls, writeSavedTabs } from './tab-restore.js';
import { buildProfileLaunchPlan } from './browser-runtime/launch-plan.js';
import { launchNativeChromium } from './browser-runtime/native-chromium.js';
import { buildFirefoxLaunchPlan, launchFirefoxNative, geckoUserDataDir } from './browser-runtime/firefox-launch.js';
import { harvestNativeTabUrls, resolveNativeTabUrlsForSave } from './session-harvest.js';
import { stopWebDriverBridge } from './webdriver-bridge.js';

export const events = new EventEmitter();
const live = new Map();      // id -> { ctx, relayUrl, browserPid, stopping }
const settling = new Map();  // removed from live; this launch is still being classified
const launching = new Map(); // id -> Promise
const launchAbort = new Map(); // id -> true when user cancelled during startup
let healthTicks = 0;
// Read-only, in-process evidence for the installed offline smoke; no HTTP surface.
// Select fields explicitly: running rows also contain CDP/relay connection details.
export function lifecycleSmokeSnapshot(id) {
  const entry = live.get(id) || settling.get(id);
  const row = db.prepare('SELECT pid FROM running WHERE id=?').get(id);
  const profile = db.prepare('SELECT last_error FROM profiles WHERE id=?').get(id);
  return {
    live: live.has(id), settling: settling.has(id), launching: launching.has(id),
    runningRow: row ? { pid: row.pid } : null, last_error: profile?.last_error ?? null,
    browserPid: entry?.browserPid ?? null, launchId: entry?.launchId ?? null,
    childPid: entry?.childPid ?? null, processCorrelation: entry?.processCorrelation ?? null,
    exitEventSeen: entry?.exitEventSeen ?? null, exitEvidenceTimedOut: entry?.exitEvidenceTimedOut ?? null,
    processAlive: entry?.browserPid ? isAlive(entry.browserPid) : null,
    stopping: entry?.stopping ?? null, cleaned: entry?.cleaned ?? null,
    exitCode: entry?.proc?.exitCode ?? entry?.exitCode ?? null,
    signal: entry?.proc?.signalCode ?? entry?.exitSignal ?? null,
    exitType: entry?.exitType ?? null, exitTypeState: entry?.exitTypeState ?? null,
  };
}
export const isRunning = id => live.has(id) || settling.has(id);
export const runningIds = () => [...new Set([...live.keys(), ...settling.keys()])];
export const liveContext = id => live.get(id)?.ctx || null;
export const launchEvidence = id => {
  const entry = live.get(id);
  return { requestedArgs: entry?.requestedArgs || null, browserPid: entry?.browserPid ?? null };
};
export const runInfo = id => db.prepare('SELECT * FROM running WHERE id=?').get(id);
const httpErr = (status, msg, code) => Object.assign(new Error(msg), { status, code });
const emit = (type, id, extra = {}) => events.emit('event', { type, id, at: new Date().toISOString(), ...extra });
const setStatus = (id, fields) => {
  const sets = Object.keys(fields).map(k => `${k}=@${k}`).join(',');
  db.prepare(`UPDATE profiles SET ${sets} WHERE id=@id`).run({ ...fields, id });
};

const freePort = () => new Promise((res, rej) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }).on('error', rej); });
const CHROME_LOCKS = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort'];
export const DATA_COPY_SKIP = new Set([...CHROME_LOCKS, LOCK_NAME]);
function clearChromeLocks(dir) { for (const f of CHROME_LOCKS) fs.rmSync(path.join(dir, f), { force: true }); }

async function cdpVersion(port) {
  try { const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) }); return r.ok ? await r.json() : null; } catch { return null; }
}
async function waitWs(port) {
  for (let i = 0; i < 100; i++) { const v = await cdpVersion(port); if (v) return v.webSocketDebuggerUrl; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('CDP endpoint did not come up');
}
// Browser pid without a debugging port: Playwright's own pipe-based CDP session.
async function pipeBrowserPid(ctx) {
  try {
    const s = await ctx.browser()?.newBrowserCDPSession(); if (!s) return null;
    const r = await s.send('SystemInfo.getProcessInfo'); await s.detach().catch(() => {});
    return r.processInfo?.find(p => p.type === 'browser')?.id ?? null;
  } catch { return null; }
}
// Automation is opt-in (missing => off). A dev-only default can force it on for every launch
// (legacy CDP e2e). Packaged apps ignore that switch; an explicit opts.automation still enables CDP.
export const automationEnabled = opts => !!opts.automation || automationDefault();
// Ask the browser for its own pid over CDP (works on every OS).
export function cdpBrowserPid(ws) {
  return new Promise(resolve => {
    let sock; const done = v => { try { sock?.close(); } catch {} resolve(v); };
    const t = setTimeout(() => done(null), 3000);
    try { sock = new WebSocket(ws); } catch { clearTimeout(t); return resolve(null); }
    sock.onopen = () => sock.send(JSON.stringify({ id: 1, method: 'SystemInfo.getProcessInfo' }));
    sock.onmessage = m => { try { const r = JSON.parse(m.data); if (r.id === 1) { clearTimeout(t); done(r.result?.processInfo?.find(p => p.type === 'browser')?.id ?? null); } } catch {} };
    sock.onerror = () => { clearTimeout(t); done(null); };
  });
}

// True only when pid is alive AND its command line still names this profile (PID-reuse guard).
async function browserOwnedByProfile(pid, dir) {
  return !!(pid && isAlive(pid) && await pidMatches(pid, dir));
}
// Another process still holds the lock. isAlive can be a reused pid; the browser command-line
// check below is what decides whether a recorded browser pid may be killed or the row dropped.
function otherLiveOwner(lock) {
  return !!(lock && !lock.corrupt && lock.ownerPid !== process.pid && !isStale(lock));
}
// A running row is stale when its pid is dead or fails the command-line check. A live matching
// browser is never overwritten. An active lock held by another live owner is left untouched
// (acquireLock reports 409). Returns true when the caller may insert a new row.
async function dropStaleRunningRow(id, dir) {
  const row = db.prepare('SELECT * FROM running WHERE id=?').get(id);
  if (!row) return true;
  if (otherLiveOwner(readLock(dir))) return false;
  if (await browserOwnedByProfile(row.pid, dir)) {
    throw httpErr(409, `Profile is already running (pid ${row.pid}).`, 'ALREADY_RUNNING');
  }
  db.prepare('DELETE FROM running WHERE id=?').run(id);
  return true;
}

// Startup recovery: clean up browsers/locks left by a previous (crashed or killed) app session.
// Rows and locks are removed only when the recorded pid is dead or fails the command-line check,
// or after that browser was actually killed. A still-matching browser and any lock held by a live
// owner are preserved.
export async function recoverAfterRestart() {
  const report = { killed: 0, cleared: 0, staleLocks: 0, skipped: 0 };
  for (const r of db.prepare('SELECT * FROM running').all()) {
    let dir; try { dir = userDataDir(r.id); } catch { db.prepare('DELETE FROM running WHERE id=?').run(r.id); continue; }
    const lock = readLock(dir);
    if (otherLiveOwner(lock)) { report.skipped++; continue; }
    const pid = r.pid || lock?.browserPid;
    if (await browserOwnedByProfile(pid, dir)) {
      if (await killTree(pid, { expect: dir })) report.killed++;
      else if (await browserOwnedByProfile(pid, dir)) { report.skipped++; continue; }
    }
    clearChromeLocks(dir); releaseLock(dir, lock?.ownerPid);
    db.prepare('DELETE FROM running WHERE id=?').run(r.id);
    report.cleared++;
    try {
      setStatus(r.id, { last_error: 'Previous browser session did not shut down cleanly. Storage was kept; launch again when ready.' });
    } catch {}
  }
  const abandoned = await sweepAbandonedLocks({ browserOwnedByProfile, killTree });
  report.staleLocks += abandoned.abandonedLocks;
  report.skipped += abandoned.skippedLive;
  return report;
}

export function recoveryStatus() {
  return recoverySnapshot({ liveCount: live.size, launchingCount: launching.size });
}

export function launch(p, opts = {}) {
  if (live.has(p.id) || settling.has(p.id)) return Promise.resolve(runInfo(p.id));
  if (launching.has(p.id)) return launching.get(p.id);
  const pr = runWithLaunchQueue(p.id, () => doLaunch(p, opts)).finally(() => {
    launching.delete(p.id);
    launchAbort.delete(p.id);
  });
  launching.set(p.id, pr);
  return pr;
}

function assertLaunchNotCancelled(id) {
  if (launchAbort.get(id)) {
    launchAbort.delete(id);
    throw httpErr(499, 'Launch was cancelled before the browser finished starting.', 'LAUNCH_CANCELLED');
  }
}

export function cancelLaunch(id) {
  if (live.has(id)) throw httpErr(409, 'Profile is already running. Stop it instead of cancelling startup.', 'ALREADY_RUNNING');
  if (!launching.has(id)) return { cancelled: false, phase: 'not_launching' };
  launchAbort.set(id, true);
  return { cancelled: true, phase: 'launching' };
}

export function launchStatus(id) {
  return {
    launching: launching.has(id),
    running: live.has(id),
    settling: settling.has(id),
    cancelRequested: !!launchAbort.get(id),
    metrics: getLaunchMetrics(id),
    queue: launchQueueState(),
  };
}

export function monitoringSessions() {
  return runningIds().map(rid => {
    const row = runInfo(rid);
    const profile = db.prepare('SELECT name, last_error FROM profiles WHERE id=?').get(rid);
    const entry = live.get(rid);
    let dir = null;
    try { dir = userDataDir(rid); } catch {}
    return {
      id: rid,
      name: profile?.name ?? null,
      pid: entry?.browserPid ?? row?.pid ?? null,
      userDataDir: dir,
      lastError: profile?.last_error ?? null,
      status: launching.has(rid) ? 'launching' : (live.has(rid) ? 'running' : 'settling'),
      launchMetrics: getLaunchMetrics(rid),
    };
  });
}

export function resourceSnapshot() {
  const sessions = monitoringSessions().map(({ launchMetrics, ...session }) => session);
  return {
    generatedAt: new Date().toISOString(),
    host: hostResourceSample(),
    browsers: profileResourceRows(sessions),
    queue: launchQueueState(),
    launchSlotsInUse: launching.size,
    runningProfiles: live.size,
  };
}

async function reconcileOrphanRunningRows() {
  for (const row of db.prepare('SELECT * FROM running').all()) {
    if (live.has(row.id) || launching.has(row.id)) continue;
    let dir;
    try { dir = userDataDir(row.id); } catch {
      db.prepare('DELETE FROM running WHERE id=?').run(row.id);
      continue;
    }
    if (!(await browserOwnedByProfile(row.pid, dir))) {
      clearChromeLocks(dir);
      releaseLock(dir);
      db.prepare('DELETE FROM running WHERE id=?').run(row.id);
    }
  }
}

async function doLaunch(p, opts = {}) {
  assertLaunchResources(live.size + launching.size + Math.max(0, pendingLaunchCount() - 1));
  const metricsHandle = beginLaunchMetrics(p.id);
  assertLaunchNotCancelled(p.id);
  const { headless, url } = opts, automation = automationEnabled(opts);
  const dir = userDataDir(p.id);
  if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory())
    throw httpErr(500, `Profile data directory is damaged (not a directory): ${dir}. Delete that file or remove the profile.`, 'CORRUPT_DIR');
  await dropStaleRunningRow(p.id, dir);
  acquireLock(dir); // throws 409 if another live process holds it
  let relayUrl = null, ctx = null, entry = null;
  let launchPlan = null;
  try {
    if ((p.browserEngine || 'chromium') === 'firefox') {
      const adv = (await import('./advanced-settings.js')).validateAdvancedSettings(p.advancedSettings || {});
      const restoreTabs = adv.preferences.restoreTabs === true;
      const saved = restoreTabs ? readSavedTabs(dir) : { urls: [] };
      const ffOpenUrls = chooseLaunchUrls({ explicitUrl: opts.url, startupUrls: adv.preferences.startupUrls, savedUrls: saved.urls });
      const fxPlan = await buildFirefoxLaunchPlan(p, { userDataDir: dir, userDataDirFn: userDataDir, opts: { ...opts, openUrls: ffOpenUrls, restoreTabs } });
      const native = await launchFirefoxNative(fxPlan);
      markContextReady(metricsHandle);
      entry = {
        ctx: null, runtime: 'native', engine: 'firefox', relayUrl: fxPlan.relayUrl, launchId: randomUUID(), browserPid: native.browserPid,
        stopping: false, closed: false, proc: native.proc, exitCode: null, exitSignal: null,
        exitType: null, exitTypeState: null, exitTypeFresh: false, preferencesBaseline: readPreferences(dir), closeReason: null,
        launchSnapshot: proxyLaunchSnapshot(p.proxy), diagnosticHeadless: false, diagnosticStart: null,
        requestedArgs: native.argv, restoreTabs: fxPlan.restoreTabs, tabUrls: [], geckoDir: fxPlan.profileDir,
      };
      captureTermination(entry, native.proc);
      const owned = await browserOwnedByProfile(native.browserPid, fxPlan.profileDir);
      entry.processCorrelation = processCorrelation(native.spawnPid, native.browserPid, owned, []);
      markBrowserReady(metricsHandle);
      native.proc.on('exit', () => onClosed(p.id, null));
      updateLock(dir, { browserPid: native.browserPid, cdpPort: null });
      live.set(p.id, entry);
      db.prepare('INSERT INTO running VALUES (?,?,?,?,?,?)').run(p.id, native.browserPid, null, null, fxPlan.relayUrl, new Date().toISOString());
      setStatus(p.id, { last_launched_at: new Date().toISOString(), last_error: null });
      emit('profile:started', p.id, { runtime: 'native', engine: 'firefox' });
      console.log('FIREFOX-LAUNCH ' + JSON.stringify({ id: p.id, launchId: entry.launchId, browserPid: native.browserPid }));
      finalizeLaunchMetrics(metricsHandle, { success: true, runtime: 'native', engine: 'firefox' });
      return runInfo(p.id);
    }
    launchPlan = await buildProfileLaunchPlan(p, { ...opts, userDataDir: dir });
    relayUrl = launchPlan.relayUrl;
    const { args, plan, regional, cdpPort } = launchPlan;
    const preferencesBaseline = readPreferences(dir);
    assertLaunchNotCancelled(p.id);

    if (launchPlan.runtime === 'native') {
      const native = await launchNativeChromium(launchPlan);
      markContextReady(metricsHandle);
      entry = {
        ctx: null, runtime: 'native', engine: 'chromium', relayUrl, launchId: randomUUID(), browserPid: native.browserPid,
        stopping: false, closed: false, proc: native.proc, exitCode: null, exitSignal: null,
        exitType: null, exitTypeState: null, exitTypeFresh: false, preferencesBaseline, closeReason: null,
        launchSnapshot: proxyLaunchSnapshot(p.proxy), diagnosticHeadless: false, diagnosticStart: null,
        requestedArgs: native.argv, restoreTabs: launchPlan.restoreTabs, tabUrls: [],
      };
      captureTermination(entry, native.proc);
      const owned = await browserOwnedByProfile(native.browserPid, dir);
      entry.processCorrelation = processCorrelation(native.spawnPid, native.browserPid, owned, []);
      readExit(entry);
      applyProfileExit(entry, dir);
      markBrowserReady(metricsHandle);
      native.proc.on('exit', () => onClosed(p.id, null));
      updateLock(dir, { browserPid: native.browserPid, cdpPort: null });
      live.set(p.id, entry);
      try {
        db.prepare('INSERT INTO running VALUES (?,?,?,?,?,?)').run(p.id, native.browserPid, null, null, relayUrl, new Date().toISOString());
      } catch (e) {
        live.delete(p.id);
        throw e;
      }
      setStatus(p.id, { last_launched_at: new Date().toISOString(), last_error: null });
      emit('profile:started', p.id, { runtime: 'native' });
      console.log('NATIVE-LAUNCH ' + JSON.stringify({ id: p.id, launchId: entry.launchId, browserPid: native.browserPid, spawnPid: native.spawnPid }));
      finalizeLaunchMetrics(metricsHandle, { success: true, runtime: 'native' });
      return runInfo(p.id);
    }

    const launchOpts = { ...launchPlan.playwrightOpts };
    if (process.platform === 'win32' && isPackaged()) launchOpts.chromiumSandbox = true;
    try { ctx = await chromium.launchPersistentContext(dir, launchOpts); }
    catch (e) {
      if (/Executable doesn't exist|please run the following command to download/i.test(e.message) && !launchPlan.executablePath) throw chromiumMissingError(!!headless, true);
      const first = String(e.message).split('\n').find(l => l.trim()) || 'unknown error';
      throw httpErr(500, `Failed to launch browser: ${first.replace(/^browserType\.launchPersistentContext:\s*/, '')}`, 'LAUNCH_FAILED');
    }
    markContextReady(metricsHandle);
    assertLaunchNotCancelled(p.id);
    if (plan.userAgent) await installUserAgent(ctx, plan.userAgent);
    const watchPermissions = page => page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) applyDocumentPermissions(page, frame.url(), plan.permissions).catch(() => {});
    });
    for (const page of ctx.pages()) watchPermissions(page);
    ctx.on('page', watchPermissions);
    entry = { ctx, runtime: 'playwright', relayUrl, launchId: randomUUID(), browserPid: null,
      stopping: false, closed: false, proc: null, exitCode: null, exitSignal: null,
      exitType: null, exitTypeState: null, exitTypeFresh: false, preferencesBaseline, closeReason: null,
      // Sanitized launch-time proxy only. The classifier never reads this field.
      launchSnapshot: proxyLaunchSnapshot(p.proxy), diagnosticHeadless: headless !== false, diagnosticStart: null,
      requestedArgs: [...args] };
    trackExit(entry); // Capture before waitWs / pipe PID discovery can yield.
    const diagnosticStart = diagnosticProcessStart(Number(entry.childPid));
    if (regional.languages.length) entry.regional = await installRegionalLocale(ctx, regional.locale || regional.languages[0], {
      onFailure: async error => {
        // Let normal close bookkeeping finish before recording the regional
        // failure; otherwise a clean process exit can clear its error message.
        if (entry.done) await entry.done;
        if (live.has(p.id) || launching.has(p.id) || !db.open) return;
        setStatus(p.id, { last_error: error.message });
        emit('profile:launch-failed', p.id, { error: error.message });
      },
    });
    const ws = automation ? await waitWs(cdpPort) : null;
    const browserPid = (ws && await cdpBrowserPid(ws)) || await pipeBrowserPid(ctx);
    entry.browserPid = browserPid;
    markBrowserReady(metricsHandle);
    // Bind identity to the launched child, never to a later PID-only lookup.
    entry.diagnosticStart = Number(browserPid) === Number(entry.childPid) ? await diagnosticStart : null;
    const owned = await browserOwnedByProfile(browserPid, dir);
    const parents = entry.childPid && browserPid && Number(entry.childPid) !== Number(browserPid)
      ? await processParents() : [];
    entry.processCorrelation = processCorrelation(entry.childPid, browserPid, owned, parents);
    readExit(entry);
    applyProfileExit(entry, dir);
    console.log('PROCESS-CORRELATION ' + JSON.stringify({ id: p.id, launchId: entry.launchId,
      childPid: entry.childPid, browserPid, correlation: entry.processCorrelation, owned }));
    updateLock(dir, { browserPid, cdpPort });
    live.set(p.id, entry);
    try {
      db.prepare('INSERT INTO running VALUES (?,?,?,?,?,?)').run(p.id, browserPid, cdpPort, ws, relayUrl, new Date().toISOString());
    } catch (e) {
      live.delete(p.id);
      throw e;
    }
    setStatus(p.id, { last_launched_at: new Date().toISOString(), last_error: null });
    ctx.on('close', () => onClosed(p.id, ctx));
    emit('profile:started', p.id);
    entry.restoreTabs = launchPlan.restoreTabs;
    entry.tabUrls = [];
    const openUrls = launchPlan.openUrls;
    if (openUrls.length) {
      const first = ctx.pages()[0] || await ctx.newPage();
      await first.goto(openUrls[0]).catch(() => {});
      await applyDocumentPermissions(first, first.url(), plan.permissions).catch(() => {});
      for (const extra of openUrls.slice(1)) {
        const page = await ctx.newPage();
        await page.goto(extra).catch(() => {});
        await applyDocumentPermissions(page, page.url(), plan.permissions).catch(() => {});
      }
    }
    if (launchPlan.restoreTabs) {
      const note = () => {
        const next = snapshotTabUrls(ctx.pages());
        if (next) entry.tabUrls = next;
      };
      const watch = page => page.on?.('framenavigated', frame => {
        try { if (!page.mainFrame || frame === page.mainFrame()) note(); } catch { note(); }
      });
      for (const page of ctx.pages()) watch(page);
      ctx.on('page', page => { watch(page); note(); });
      note();
    }
    finalizeLaunchMetrics(metricsHandle, { success: true });
    return runInfo(p.id);
  } catch (e) {
    entry?.detachTermination?.();
    if (ctx && !live.has(p.id)) await ctx.close().catch(() => {});
    if (relayUrl) await closeAnonymizedProxy(relayUrl, true).catch(() => {});
    releaseLock(dir);
    const classified = classifyLaunchError(e.status ? e : httpErr(500, e.message, 'LAUNCH_FAILED'));
    finalizeLaunchMetrics(metricsHandle, { success: false, errorCode: classified.code });
    if (classified.code !== 'LAUNCH_CANCELLED') {
      try { setStatus(p.id, { last_error: classified.message }); } catch {}
    }
    emit('profile:launch-failed', p.id, { error: classified.message, launch: classified });
    throw e.status ? e : httpErr(500, classified.message, classified.code);
  }
}

// playwright-core 1.64.1 does not put process() on the Browser client. The in-process
// connection's server browser holds the launched Node child:
// node_modules/playwright-core/lib/coreBundle.js line 41263 (`process: launchedProcess`
// inside BrowserType._launchProcess). That object is browserOptions.browserProcess
// (line 41142), stored as this.options (line 54032). clientConnection.toImpl (line 65544)
// returns that server browser. If this reference is missing, the caller must not treat
// the profile as crashed; trackExit logs CLASSIFIER-FALLBACK and leaves the exit code unknown.
export function browserProcess(ctx) {
  try {
    const browser = ctx.browser?.();
    if (!browser) return null;
    if (typeof browser.process === 'function' && browser.process()) return browser.process();
    const impl = browser._connection?.toImpl?.(browser);
    return impl?.options?.browserProcess?.process || null;
  } catch { return null; }
}
// profile.exit_type in Default/Preferences, confirmed against current Chromium main:
// exit_type_service.cc writes "Normal", "Crashed", and "SessionEnded"
// (https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/sessions/exit_type_service.cc).
// ExitType in exit_type_service.h maps those to a clean shutdown, a crash, and an OS-forced
// shutdown (WM_ENDSESSION / logoff). BrowserProcessImpl::EndSession stores the OS case as
// SessionEnded. profile_impl.cc asks ExitTypeService and treats only kCrashed as a crash
// (https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/profiles/profile_impl.cc).
// The service writes Crashed as the profile opens, and Normal only when it shuts down cleanly.
export function trackExit(entry) {
  const proc = entry.runtime === 'native' ? entry.proc : browserProcess(entry.ctx);
  captureTermination(entry, proc);
  if (!entry.proc) console.warn('CLASSIFIER-FALLBACK playwright browser process handle is missing; not treating that as a crash');
}
function readExit(entry) { entry.readTermination?.(); }
function readProfileExit(dir) { return readPreferences(dir); }
function applyProfileExit(entry, dir) { observePreferences(entry, readProfileExit(dir)); }
const CLEAN_EXIT_TYPES = new Set(['Normal', 'SessionEnded']);
// How long to wait for the PID to die. Process death and delivery of the child
// exit status are separate observations; stdio can delay close, not exit.
const PID_WAIT_MS = 3000;
// Chromium writes Preferences during shutdown. Until the pid is dead the file can
// still say Crashed, which is the value written when the profile opened. After the
// pid is dead, poll briefly so Normal or SessionEnded can replace that.
const PREFS_AFTER_EXIT_MS = 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function browserDead(entry) {
  readExit(entry);
  if (entry.exitSignal) return true;
  if (entry.exitCode !== null && entry.exitCode !== undefined) return true;
  return !!(entry.browserPid && !isAlive(entry.browserPid));
}
async function waitUntilDead(entry, ms) {
  const proc = entry.proc;
  if (browserDead(entry)) return;
  await new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearInterval(iv);
      clearTimeout(t);
      proc?.removeListener('exit', onExit);
      resolve();
    };
    const onExit = () => {
      readExit(entry); // Never promote an unverified launcher event to browser evidence.
      if (browserDead(entry)) finish();
    };
    const iv = setInterval(() => { if (browserDead(entry)) finish(); }, 50);
    const t = setTimeout(finish, ms);
    if (proc) proc.on('exit', onExit);
  });
}
export async function waitForCloseEvidence(entry, dir, { exitStatusMs = 3000, prefsMs = PREFS_AFTER_EXIT_MS } = {}) {
  await waitUntilDead(entry, PID_WAIT_MS);
  if (!browserDead(entry)) return;
  // Even when liveness already says dead, preserve a bounded opportunity for
  // the matching child status to arrive before inspecting fallback Preferences.
  await waitForTermination(entry, exitStatusMs);
  const started = Date.now();
  while (Date.now() - started < prefsMs) {
    applyProfileExit(entry, dir);
    if (entry.exitTypeFresh && CLEAN_EXIT_TYPES.has(entry.exitType)) return;
    await sleep(50);
  }
  applyProfileExit(entry, dir);
}
// Two observations, recorded on every close as CLASSIFIER-EVIDENCE. Neither one is a
// crash when it has nothing to say.
//
// Exit-code approach (93c54e0, except a missing code is unknown rather than a crash):
//   signal            → error
//   exit code 0       → stopped
//   any other number  → error
//   null / undefined  → unknown
//
// Preferences approach, read only after the pid is fully dead (Chromium writes
// Crashed when the profile opens and rewrites the file during shutdown):
//   Normal, SessionEnded → stopped
//   Crashed              → error
//   missing, unreadable, or any other string → unknown
// SessionEnded is ExitType::kForcedShutdown (OS logoff / WM_ENDSESSION), not a crash.
// See exit_type_service.cc, exit_type_service.h, BrowserProcessImpl::EndSession,
// and profile_impl.cc (only kCrashed restores a crashed session).
//
// Combination, chosen because each source is wrong in a case the other covers:
//   stopping                         → stopped (app Stop, even if the tree kill signals)
//   still alive after the wait       → error (the process did not exit; not an unknown code)
//   SessionEnded                     → stopped, even if the OS then kills the process
//   known exit code or signal        → that result. Code 0 stays Stopped when the file
//                                      is missing (headless shell never writes it) or
//                                      still says Crashed (startup sentinel). A signal
//                                      or a non-zero code stays Error.
//   unknown code + current-launch Crashed → error
//   unknown code + current-launch Normal  → stopped
//   unknown code + stale/missing/unreadable/other → unknown (no new UI/DB status)
export function classifyExitCode(entry) {
  if (entry.exitSignal) return 'error';
  if (typeof entry.exitCode === 'number') return entry.exitCode === 0 ? 'stopped' : 'error';
  return 'unknown';
}
export function classifyPreferences(entry) {
  if (entry.exitTypeState !== 'ok' || entry.exitTypeFresh === false) return 'unknown';
  if (CLEAN_EXIT_TYPES.has(entry.exitType)) return 'stopped';
  if (entry.exitType === 'Crashed') return 'error';
  return 'unknown';
}
export function terminationOutcome(entry) {
  if (entry.stopping) return 'stopped';
  if (entry.stillAlive) return 'error';
  if (entry.exitTypeState === 'ok' && entry.exitTypeFresh !== false && entry.exitType === 'SessionEnded') return 'stopped';
  const byCode = classifyExitCode(entry);
  if (byCode !== 'unknown') return byCode;
  return classifyPreferences(entry);
}
// Existing external/unit helper keeps the legacy stopped presentation for unknown.
// Production finalization uses terminationOutcome directly and retains unknown.
export function closeOutcome(entry) {
  const outcome = terminationOutcome(entry);
  return outcome === 'unknown' ? 'stopped' : outcome;
}
function logClassifierEvidence(id, entry, chosen) {
  let name = null;
  try { name = db.prepare('SELECT name FROM profiles WHERE id=?').get(id)?.name ?? null; } catch {}
  const byCode = classifyExitCode(entry);
  const byPrefs = classifyPreferences(entry);
  console.log('CLASSIFIER-EVIDENCE ' + JSON.stringify({
    id, name, launchId: entry.launchId ?? null,
    childPid: entry.childPid ?? null, browserPid: entry.browserPid ?? null,
    processCorrelation: entry.processCorrelation ?? null,
    childExitCode: entry.childExitCode ?? null, childExitSignal: entry.childExitSignal ?? null,
    exitEventSeen: !!entry.exitEventSeen, exitEvidenceSource: entry.exitEvidenceSource ?? null,
    exitEvidenceTimedOut: !!entry.exitEvidenceTimedOut, exitTypeFresh: entry.exitTypeFresh ?? null,
    exitCode: entry.exitCode ?? null,
    signal: entry.exitSignal ?? null,
    exitType: entry.exitType ?? null,
    exitTypeState: entry.exitTypeState ?? null,
    procMissing: !entry.proc,
    stopping: !!entry.stopping,
    stillAlive: !!entry.stillAlive,
    exitCodeApproach: byCode,
    prefsApproach: byPrefs,
    chosen,
  }));
  if (!entry.stopping && !entry.stillAlive && byCode === 'unknown' && byPrefs === 'unknown') {
    console.warn('CLASSIFIER-UNKNOWN exit code and exit_type are both unknown; not marking a crash');
  }
}
function crashMessage(entry, reason) {
  readExit(entry);
  const bits = [];
  if (entry.stillAlive) bits.push('process still alive');
  if (entry.exitSignal) bits.push(`signal ${entry.exitSignal}`);
  else if (typeof entry.exitCode === 'number' && entry.exitCode !== 0) bits.push(`exit code ${entry.exitCode}`);
  if (entry.exitType === 'Crashed') bits.push('exit_type Crashed');
  else if (entry.exitTypeState === 'unreadable') bits.push('exit_type unreadable');
  else if (entry.exitTypeState === 'missing') bits.push('exit_type missing');
  else if (entry.exitType && !CLEAN_EXIT_TYPES.has(entry.exitType)) bits.push(`exit_type ${entry.exitType}`);
  const detail = bits.join(', ');
  if (reason && detail) return `${reason} (${detail})`;
  if (reason) return reason;
  if (detail) return `Browser exited unexpectedly (${detail})`;
  return 'Browser exited unexpectedly';
}

export function onClosed(id, ctx, reason) {
  const e = live.get(id);
  if (!e || (ctx && e.ctx !== ctx)) return Promise.resolve();
  // One-shot per launch. The close event, the health monitor, Stop, and a relaunch
  // all meet here. The second caller finds the entry gone and does not classify again.
  if (e.cleaned || e.done) return e.done || Promise.resolve();
  live.delete(id);
  settling.set(id, e);
  if (reason && !e.closeReason) e.closeReason = reason;
  e.done = finishClose(id, e).finally(() => { if (settling.get(id) === e) settling.delete(id); });
  return e.done;
}
function ownsLock(lock, browserPid) {
  if (!lock || lock.corrupt) return true;
  if (!lock.browserPid || !browserPid) return true;
  return lock.browserPid === browserPid;
}
async function finishClose(id, e) {
  if (e.cleaned) return;
  e.cleaned = true;
  let dir = null;
  try { dir = userDataDir(id); } catch {}
  // App Stop used to release the row while the pid was still alive. Wait for the
  // process to exit first, and only then read Preferences.
  if (e.stopping) await waitUntilDead(e, PID_WAIT_MS);
  else await waitForCloseEvidence(e, dir);
  if (!browserDead(e) && e.browserPid && isAlive(e.browserPid)) {
    try { await killTree(e.browserPid, { expect: dir || userDataDir(id) }); } catch {}
    await waitUntilDead(e, 2000);
  }
  readExit(e);
  e.stillAlive = !browserDead(e);
  if (browserDead(e) && !e.exitTypeState) applyProfileExit(e, dir);
  const outcome = terminationOutcome(e);
  const crashed = outcome === 'error';
  logClassifierEvidence(id, e, outcome);
  // A newer launch owns the row and the lock. releaseLock keys off ownerPid, which
  // is this server for both launches, so the browser pid has to match too.
  const superseded = live.has(id) || launching.has(id);
  if (!superseded) {
    const row = db.prepare('SELECT pid FROM running WHERE id=?').get(id);
    if (!row || !e.browserPid || !row.pid || row.pid === e.browserPid) {
      db.prepare('DELETE FROM running WHERE id=?').run(id);
    }
    try {
      if (dir && ownsLock(readLock(dir), e.browserPid)) {
        releaseLock(dir);
        if (crashed) clearChromeLocks(dir);
      }
    } catch {}
    if (crashed) {
      const message = crashMessage(e, e.closeReason);
      try { setStatus(id, { last_error: message }); } catch {}
      emit('profile:crashed', id, { error: message });
      emit('profile:stopped', id, { error: message });
    } else if (outcome === 'stopped') {
      try { setStatus(id, { last_error: null }); } catch {}
      if (e.restoreTabs && dir) {
        try {
          const tabs = e.runtime === 'native'
            ? resolveNativeTabUrlsForSave({
              engine: e.engine || 'chromium',
              chromiumDir: dir,
              geckoDir: e.geckoDir || geckoUserDataDir(id, userDataDir),
              existing: e.tabUrls || [],
            })
            : (e.tabUrls || []);
          writeSavedTabs(dir, tabs);
        } catch { /* a tab list must not change the stop result */ }
      }
      emit('profile:stopped', id, { error: null });
    } else {
      // No new persisted/UI status. Release dead-process resources, preserve the
      // existing error field, and explicitly report uncertainty in evidence/events.
      const error = db.prepare('SELECT last_error FROM profiles WHERE id=?').get(id)?.last_error ?? null;
      emit('profile:stopped', id, { error, termination: 'unknown' });
    }
  }
  // The relay belongs to this launch. Close it after the row and the lock are gone
  // so a clean window close is already Stopped, including for an authenticated SOCKS proxy.
  if (e.relayUrl) await closeAnonymizedProxy(e.relayUrl, true).catch(() => {});
  e.detachTermination?.();
  e.closed = true;
}

// Health monitor: detects browsers that died without Playwright noticing (e.g. killed externally).
let healthTimer = null;
export function startHealthMonitor(intervalMs = Number(process.env.PM_HEALTH_INTERVAL || 3000)) {
  stopHealthMonitor();
  healthTimer = setInterval(() => {
    healthTicks += 1;
    for (const [id, e] of live) {
      if (!e.stopping && e.browserPid && !isAlive(e.browserPid)) onClosed(id, e.ctx, 'Browser process died (detected by health monitor)');
      else if (!e.stopping) {
        applyProfileExit(e, userDataDir(id));
        if (e.restoreTabs && e.runtime === 'native' && healthTicks % 10 === 0) {
          try {
            const dir = userDataDir(id);
            const tabs = resolveNativeTabUrlsForSave({
              engine: e.engine || 'chromium',
              chromiumDir: dir,
              geckoDir: e.geckoDir || geckoUserDataDir(id, userDataDir),
              existing: e.tabUrls || [],
            });
            if (tabs.length) {
              e.tabUrls = tabs;
              writeSavedTabs(dir, tabs);
            }
          } catch { /* periodic snapshot only */ }
        }
      }
    }
    if (healthTicks % 10 === 0) reconcileOrphanRunningRows().catch(() => {});
  }, intervalMs);
  healthTimer.unref?.();
}
export const stopHealthMonitor = () => { if (healthTimer) clearInterval(healthTimer); healthTimer = null; };

export async function stop(id, { timeoutMs = 5000 } = {}) {
  stopWebDriverBridge(id);
  if (launching.has(id)) await launching.get(id).catch(() => {});
  const e = live.get(id) || settling.get(id);
  if (!e) { db.prepare('DELETE FROM running WHERE id=?').run(id); return; }
  e.stopping = true;
  if (e.restoreTabs && e.ctx) {
    try {
      const next = snapshotTabUrls(e.ctx.pages());
      if (next) e.tabUrls = next;
    } catch { /* keep the last navigation snapshot */ }
  } else if (e.restoreTabs && e.runtime === 'native') {
    try {
      const dir = userDataDir(id);
      const tabs = resolveNativeTabUrlsForSave({
        engine: e.engine || 'chromium',
        chromiumDir: dir,
        geckoDir: e.geckoDir || geckoUserDataDir(id, userDataDir),
        existing: e.tabUrls || [],
      });
      if (tabs.length) {
        e.tabUrls = tabs;
        writeSavedTabs(dir, tabs);
      }
    } catch { /* best effort */ }
  }
  if (!live.has(id)) { if (e.done) await e.done; return; }
  // 1) graceful: close the context  2) force: kill the process tree
  if (e.ctx) await Promise.race([e.ctx.close().catch(() => {}), new Promise(r => setTimeout(r, timeoutMs))]);
  if (e.browserPid && isAlive(e.browserPid)) await killTree(e.browserPid, { expect: userDataDir(id) });
  if (e.done) await e.done;
  else await onClosed(id, e.ctx);
}
export async function shutdown() {
  stopHealthMonitor();
  const { stopAllWebDriverBridges } = await import('./webdriver-bridge.js');
  stopAllWebDriverBridges();
  // Parallel close, each bounded, so a stuck browser cannot hold shutdown open.
  await Promise.all(runningIds().map(id => stop(id, { timeoutMs: 10000 })));
}

// --- Read-only diagnostics observation. Not used by the lifecycle classifier. ---
const PROXY_TYPES = new Set(['http', 'https', 'socks5']);

function isRelayHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || h === '::' || h === '0.0.0.0' || /^127(?:\.\d{1,3}){3}$/.test(h);
}

// Launch-time proxy with credentials and local relay endpoints removed.
// `{ configured: false }` means no proxy. `{ unsafe: true }` means a proxy existed
// but must not be published. The returned object never keeps username, password, or a URL.
export function proxyLaunchSnapshot(proxy) {
  try {
    if (!proxy || typeof proxy !== 'object') return { configured: false };
    const host = proxy.host;
    if (host == null || host === '') return { configured: false };
    if (typeof host !== 'string' || typeof proxy.type !== 'string') return { unsafe: true };
    if (!PROXY_TYPES.has(proxy.type)) return { unsafe: true };
    if (host.length === 0 || host.length > 253 || /[\s@/\\?#]/.test(host)) return { unsafe: true };
    const hostOk = /^[A-Za-z0-9.-]+$/.test(host) || /^\[[0-9A-Fa-f:.]+\]$/.test(host);
    if (!hostOk) return { unsafe: true };
    const port = typeof proxy.port === 'number' ? proxy.port : Number(proxy.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { unsafe: true };
    const bare = host.startsWith('[') ? host.slice(1, -1) : host;
    if (isRelayHost(bare)) return { unsafe: true };
    return { configured: true, type: proxy.type, host, port };
  } catch {
    return { unsafe: true };
  }
}

function relayMatches(snapshot, relayUrl) {
  if (!snapshot || snapshot.configured !== true || typeof relayUrl !== 'string' || !relayUrl) return false;
  try {
    const url = new URL(relayUrl);
    const port = Number(url.port);
    const host = url.hostname;
    if (!host || !Number.isInteger(port)) return false;
    const snapHost = snapshot.host.startsWith('[') ? snapshot.host.slice(1, -1) : snapshot.host;
    return snapHost.toLowerCase() === host.toLowerCase() && snapshot.port === port;
  } catch {
    return false;
  }
}

function publishProxy(snapshot, relayUrl) {
  if (!snapshot || snapshot.unsafe || relayMatches(snapshot, relayUrl)) return { state: 'suppressed' };
  if (snapshot.configured === false) return { state: 'off' };
  if (snapshot.configured === true && PROXY_TYPES.has(snapshot.type)) {
    return { state: 'on', value: { configured: true, type: snapshot.type, host: snapshot.host, port: snapshot.port } };
  }
  return { state: 'suppressed' };
}

function chromiumVersionFromProduct(product) {
  if (typeof product !== 'string' || product.length > 256) return null;
  const match = /^(?:HeadlessChrome|Chrome)\/(\d{1,8}(?:\.\d{1,8}){1,3})$/.exec(product);
  if (!match || match[1].length > 128) return null;
  return match[1];
}

function userAgentFromProtocol(userAgent) {
  if (typeof userAgent !== 'string' || userAgent.length < 1 || userAgent.length > 1024) return null;
  if (!/^[\x20-\x7E]+$/.test(userAgent)) return null;
  return userAgent;
}

// Browser.getVersion only on the existing Playwright pipe. OS policy is separate.
export async function readPipeBrowserFacts(browser, hooks = {}) {
  const empty = { chromiumVersion: null, userAgent: null, webrtc: { kind: 'unreadable' } };
  if (!browser || typeof browser.newBrowserCDPSession !== 'function') return empty;
  let session;
  try { session = await browser.newBrowserCDPSession(); } catch { return empty; }
  try { hooks.trackSession?.(session); } catch { /* ignore */ }
  try {
    if (hooks.cancelled?.()) return { ...empty, cancelled: true };
    let versionRaw = null;
    try { versionRaw = await session.send('Browser.getVersion'); } catch { versionRaw = null; }
    if (hooks.cancelled?.()) return { ...empty, cancelled: true };
    return {
      chromiumVersion: chromiumVersionFromProduct(versionRaw && versionRaw.product),
      userAgent: userAgentFromProtocol(versionRaw && versionRaw.userAgent),
      webrtc: { kind: 'unreadable' },
    };
  } finally {
    try { await session.detach(); } catch { /* ignore */ }
  }
}

function publishedLaunchId(launchId) {
  if (typeof launchId !== 'string' || launchId.length < 1 || launchId.length > 128) return null;
  if (!/^[\x21-\x7E]+$/.test(launchId)) return null;
  return launchId;
}

function connectedBrowser(entry) {
  try {
    const browser = entry.ctx?.browser?.();
    if (!browser) return null;
    if (typeof browser.isConnected === 'function' && browser.isConnected() === false) return null;
    return browser;
  } catch {
    return null;
  }
}

// Plain view of one live entry. Browser objects and command lines are not copied onto it.
export function inspectDiagnosticEntry(entry, current = () => true) {
  const launchId = publishedLaunchId(entry?.launchId);
  const suppressed = { phase: 'not_running', launchId: null, proxy: { state: 'suppressed' } };
  if (!entry || !entry.ctx) return suppressed;
  if (entry.stopping) return { phase: 'stopping', launchId, proxy: { state: 'suppressed' } };
  const browser = connectedBrowser(entry);
  if (!browser) return { phase: 'disconnected', launchId, proxy: { state: 'suppressed' } };
  const proxy = publishProxy(entry.launchSnapshot, entry.relayUrl);
  return {
    phase: 'connected',
    launchId,
    proxy,
    headless: entry.diagnosticHeadless !== false,
    readPipeFacts: async hooks => {
      const launchId = entry.launchId, pid = entry.browserPid, start = entry.diagnosticStart;
      const stillCurrent = () => current() && entry.launchId === launchId && entry.browserPid === pid
        && entry.diagnosticStart === start && !entry.stopping && !entry.closed
        && connectedBrowser(entry) === browser;
      const [facts, webrtc] = await Promise.all([
        readPipeBrowserFacts(browser, hooks),
        observeProcessPolicy({ pid, start, launchId, stillCurrent, signal: hooks.signal }),
      ]);
      return { ...facts, webrtc };
    },
    openDiagnosticPage: async hooks => {
      if (entry.diagnosticHeadless !== false) throw new Error('headless');
      const page = entry.regional ? await openRegionalDiagnosticPage(entry, hooks) : await entry.ctx.newPage();
      // Dedicated page session: detaching cancels pending Runtime.evaluate without
      // closing the visible tab or touching the shared browser connection.
      page.diagnosticEvaluate = async fn => {
        const session = await entry.ctx.newCDPSession(page);
        hooks.trackSession(session);
        try {
          if (hooks.cancelled()) throw new Error('cancelled');
          const result = await session.send('Runtime.evaluate', {
            expression: `(${fn.toString()})()`, returnByValue: true,
          });
          if (result.exceptionDetails) throw new Error('evaluation failed');
          return result.result?.value;
        } finally { await session.detach().catch(() => {}); }
      };
      return page;
    },
  };
}

// Pinned playwright-core 1.64.1 bridge (see browserProcess()): server page targetId.
const pageTargetId = page => {
  try { return page._connection?.toImpl?.(page)?.delegate?._targetId; } catch { return undefined; }
};

// M3 regional profiles: the diagnostic tab is created by the regional-locale
// controller so its targetId is registered before any failure is judged.
async function openRegionalDiagnosticPage(entry, hooks) {
  const ctx = entry.ctx, signal = hooks.signal;
  const before = new Set(ctx.pages());
  let onAbort, onPage;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(new Error('cancelled'));
    if (signal?.aborted) onAbort(); else signal?.addEventListener?.('abort', onAbort, { once: true });
  });
  aborted.catch(() => {});
  try {
    const { targetId, ready } = await Promise.race([entry.regional.createDiagnosticTarget(), aborted]);
    await Promise.race([ready, aborted]);
    const found = new Promise((resolve, reject) => {
      const check = page => {
        if (before.has(page)) return;
        const id = pageTargetId(page);
        if (!id) return reject(new Error('Diagnostic target bridge unavailable'));
        if (id === targetId) resolve(page);
      };
      onPage = check;
      ctx.on('page', onPage);
      for (const page of ctx.pages()) check(page);
    });
    return await Promise.race([found, aborted]);
  } finally {
    if (onPage) ctx.off('page', onPage);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

export function diagnosticObservation(id) {
  try {
    if (live.has(id)) {
      const entry = live.get(id);
      return inspectDiagnosticEntry(entry, () => live.get(id) === entry);
    }
    if (launching.has(id)) return { phase: 'launching', launchId: null, proxy: { state: 'suppressed' } };
    // t48u §8: an app Stop settles as 'stopping'; a browser that closed or died on
    // its own (crash, kill, last window closed) settles as 'disconnected'.
    if (settling.has(id)) return { phase: settling.get(id).stopping ? 'stopping' : 'disconnected', launchId: null, proxy: { state: 'suppressed' } };
    return { phase: 'not_running', launchId: null, proxy: { state: 'suppressed' } };
  } catch {
    return { phase: 'not_running', launchId: null, proxy: { state: 'suppressed' } };
  }
}

