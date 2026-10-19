// Browser engine: launch/stop with per-profile locks, persisted running state, startup recovery,
// crash detection (health monitor), safe shutdown, a local proxy relay and (opt-in) CDP endpoints.
// The remote-debugging port is OFF unless the launch option `automation` is truthy: an open CDP port
// gives any local process full control of the session.
import fs from 'fs';
import net from 'net';
import path from 'path';
import { EventEmitter } from 'events';
import { chromium } from 'playwright';
import { anonymizeProxy, closeAnonymizedProxy } from 'proxy-chain';
import { db, userDataDir, getSetting } from './db.js';
import { acquireLock, releaseLock, updateLock, readLock, isStale, LOCK_NAME } from './lock.js';
import { isAlive, killTree, pidMatches } from './proc.js';
import { chromiumMissingError } from './chromium.js';
import { automationDefault, proxyLoopback } from './testflags.js';

export const events = new EventEmitter();
const live = new Map();      // id -> { ctx, relayUrl, browserPid, stopping }
const settling = new Map();  // removed from live; this launch is still being classified
const launching = new Map(); // id -> Promise
export const isRunning = id => live.has(id) || settling.has(id);
export const runningIds = () => [...new Set([...live.keys(), ...settling.keys()])];
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
  }
  // Locks without a running row (e.g. crash mid-launch)
  const root = path.dirname(userDataDir('00000000-0000-0000-0000-000000000000'));
  for (const id of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    const dir = path.join(root, id), lock = readLock(dir);
    if (!lock || !isStale(lock)) continue;
    const pid = lock.browserPid;
    if (await browserOwnedByProfile(pid, dir)) {
      if (await killTree(pid, { expect: dir })) report.killed++;
      else if (await browserOwnedByProfile(pid, dir)) continue;
    }
    fs.rmSync(path.join(dir, LOCK_NAME), { force: true }); clearChromeLocks(dir); report.staleLocks++;
  }
  return report;
}

export function launch(p, opts = {}) {
  if (live.has(p.id) || settling.has(p.id)) return Promise.resolve(runInfo(p.id));
  if (launching.has(p.id)) return launching.get(p.id);
  const pr = doLaunch(p, opts).finally(() => launching.delete(p.id));
  launching.set(p.id, pr);
  return pr;
}

async function doLaunch(p, opts = {}) {
  const { headless, url } = opts, automation = automationEnabled(opts);
  const dir = userDataDir(p.id);
  if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory())
    throw httpErr(500, `Profile data directory is damaged (not a directory): ${dir}. Delete that file or remove the profile.`, 'CORRUPT_DIR');
  await dropStaleRunningRow(p.id, dir);
  acquireLock(dir); // throws 409 if another live process holds it
  let relayUrl = null, ctx = null;
  try {
    const cdpPort = automation ? await freePort() : null;
    const args = automation ? [`--remote-debugging-port=${cdpPort}`, '--remote-debugging-address=127.0.0.1'] : [];
    const executablePath = getSetting('executablePath', '') || undefined;
    if (!executablePath) { const miss = chromiumMissingError(!!headless); if (miss) throw miss; }
    // We own shutdown: Playwright's own signal handlers would kill browsers before cookies/storage are flushed.
    const launchOpts = { headless, viewport: null, args, executablePath, timeout: 30000, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false };
    if (p.proxy) {
      if (p.proxy.username) {
        // Chromium can't authenticate to SOCKS proxies (and prompts for HTTP); use a local no-auth relay.
        const up = `${p.proxy.type}://${encodeURIComponent(p.proxy.username)}:${encodeURIComponent(p.proxy.password)}@${p.proxy.host}:${p.proxy.port}`;
        relayUrl = await anonymizeProxy({ url: up, port: await freePort() });
        launchOpts.proxy = { server: relayUrl };
      } else launchOpts.proxy = { server: `${p.proxy.type}://${p.proxy.host}:${p.proxy.port}` };
      if (proxyLoopback()) args.push('--proxy-bypass-list=<-loopback>'); // dev/test only; packaged builds ignore it
    }
    try { ctx = await chromium.launchPersistentContext(dir, launchOpts); }
    catch (e) {
      if (/Executable doesn't exist|please run the following command to download/i.test(e.message) && !executablePath) throw chromiumMissingError(!!headless, true);
      const first = String(e.message).split('\n').find(l => l.trim()) || 'unknown error';
      throw httpErr(500, `Failed to launch browser: ${first.replace(/^browserType\.launchPersistentContext:\s*/, '')}`, 'LAUNCH_FAILED');
    }
    const ws = automation ? await waitWs(cdpPort) : null;
    const browserPid = (ws && await cdpBrowserPid(ws)) || await pipeBrowserPid(ctx);
    updateLock(dir, { browserPid, cdpPort });
    const entry = { ctx, relayUrl, browserPid, stopping: false, closed: false, proc: null, exitCode: null, exitSignal: null, exitType: null, exitTypeState: null, closeReason: null };
    live.set(p.id, entry);
    try {
      db.prepare('INSERT INTO running VALUES (?,?,?,?,?,?)').run(p.id, browserPid, cdpPort, ws, relayUrl, new Date().toISOString());
    } catch (e) {
      live.delete(p.id);
      throw e;
    }
    setStatus(p.id, { last_launched_at: new Date().toISOString(), last_error: null });
    trackExit(entry);
    ctx.on('close', () => onClosed(p.id, ctx));
    emit('profile:started', p.id);
    if (url) await (ctx.pages()[0] || await ctx.newPage()).goto(url).catch(() => {});
    return runInfo(p.id);
  } catch (e) {
    if (ctx && !live.has(p.id)) await ctx.close().catch(() => {});
    if (relayUrl) await closeAnonymizedProxy(relayUrl, true).catch(() => {});
    releaseLock(dir);
    try { setStatus(p.id, { last_error: e.message }); } catch {}
    emit('profile:launch-failed', p.id, { error: e.message });
    throw e.status ? e : httpErr(500, `Failed to launch browser: ${e.message}`, 'LAUNCH_FAILED');
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
  const proc = browserProcess(entry.ctx);
  entry.proc = proc;
  if (!proc) {
    console.warn('CLASSIFIER-FALLBACK playwright browser process handle is missing; not treating that as a crash');
    return;
  }
  if (proc.exitCode !== null && proc.exitCode !== undefined) entry.exitCode = proc.exitCode;
  if (proc.signalCode) entry.exitSignal = proc.signalCode;
  proc.once('exit', (code, signal) => {
    entry.exitCode = code;
    entry.exitSignal = signal;
  });
}
function readExit(entry) {
  const proc = entry.proc;
  if (!proc) return;
  if (proc.exitCode !== null && proc.exitCode !== undefined) entry.exitCode = proc.exitCode;
  if (proc.signalCode) entry.exitSignal = proc.signalCode;
}
// missing: no file or no string. unreadable: the file is there but is not JSON yet.
function readProfileExit(dir) {
  if (!dir) return { state: 'missing' };
  const file = path.join(dir, 'Default', 'Preferences');
  if (!fs.existsSync(file)) return { state: 'missing' };
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))?.profile?.exit_type;
    if (typeof value !== 'string' || !value) return { state: 'missing' };
    return { state: 'ok', value };
  } catch { return { state: 'unreadable' }; }
}
function applyProfileExit(entry, dir) {
  const reading = readProfileExit(dir);
  entry.exitTypeState = reading.state;
  entry.exitType = reading.state === 'ok' ? reading.value : null;
}
const CLEAN_EXIT_TYPES = new Set(['Normal', 'SessionEnded']);
// How long to wait for the pid to die. The SOCKS relay can hold the child-handle
// exit event after the window is already gone.
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
    const onExit = (code, signal) => {
      entry.exitCode = code;
      entry.exitSignal = signal;
      if (browserDead(entry)) finish();
    };
    const iv = setInterval(() => { if (browserDead(entry)) finish(); }, 50);
    const t = setTimeout(finish, ms);
    if (proc) proc.on('exit', onExit);
  });
}
async function waitForCloseEvidence(entry, dir) {
  await waitUntilDead(entry, PID_WAIT_MS);
  if (!browserDead(entry)) return;
  const started = Date.now();
  while (Date.now() - started < PREFS_AFTER_EXIT_MS) {
    applyProfileExit(entry, dir);
    if (CLEAN_EXIT_TYPES.has(entry.exitType)) return;
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
//   unknown code + Crashed           → error
//   unknown code + Normal            → stopped
//   unknown code + missing/unreadable/other → stopped, and CLASSIFIER-UNKNOWN is logged
export function classifyExitCode(entry) {
  if (entry.exitSignal) return 'error';
  if (typeof entry.exitCode === 'number') return entry.exitCode === 0 ? 'stopped' : 'error';
  return 'unknown';
}
export function classifyPreferences(entry) {
  if (entry.exitTypeState !== 'ok') return 'unknown';
  if (CLEAN_EXIT_TYPES.has(entry.exitType)) return 'stopped';
  if (entry.exitType === 'Crashed') return 'error';
  return 'unknown';
}
export function closeOutcome(entry) {
  if (entry.stopping) return 'stopped';
  if (entry.stillAlive) return 'error';
  if (entry.exitTypeState === 'ok' && entry.exitType === 'SessionEnded') return 'stopped';
  const byCode = classifyExitCode(entry);
  if (byCode !== 'unknown') return byCode;
  if (classifyPreferences(entry) === 'error') return 'error';
  return 'stopped';
}
function logClassifierEvidence(id, entry, chosen) {
  let name = null;
  try { name = db.prepare('SELECT name FROM profiles WHERE id=?').get(id)?.name ?? null; } catch {}
  const byCode = classifyExitCode(entry);
  const byPrefs = classifyPreferences(entry);
  console.log('CLASSIFIER-EVIDENCE ' + JSON.stringify({
    id, name,
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
function cleanExit(entry) {
  readExit(entry);
  return closeOutcome(entry) === 'stopped';
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

function onClosed(id, ctx, reason) {
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
  if (!e.stopping) await waitForCloseEvidence(e, dir);
  readExit(e);
  e.stillAlive = !e.stopping && !browserDead(e);
  // Preferences is meaningful only after the process has fully exited.
  if (!e.stillAlive && browserDead(e) && !e.exitTypeState) applyProfileExit(e, dir);
  const crashed = !cleanExit(e);
  logClassifierEvidence(id, e, crashed ? 'error' : 'stopped');
  if (crashed && e.browserPid && isAlive(e.browserPid)) {
    try { await killTree(e.browserPid, { expect: dir || userDataDir(id) }); } catch {}
  }
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
    } else {
      try { setStatus(id, { last_error: null }); } catch {}
    }
    emit('profile:stopped', id);
  }
  // The relay belongs to this launch. Close it after the row and the lock are gone
  // so a clean window close is already Stopped, including for an authenticated SOCKS proxy.
  if (e.relayUrl) await closeAnonymizedProxy(e.relayUrl, true).catch(() => {});
  e.closed = true;
}

// Health monitor: detects browsers that died without Playwright noticing (e.g. killed externally).
let healthTimer = null;
export function startHealthMonitor(intervalMs = Number(process.env.PM_HEALTH_INTERVAL || 3000)) {
  stopHealthMonitor();
  healthTimer = setInterval(() => {
    for (const [id, e] of live) if (!e.stopping && e.browserPid && !isAlive(e.browserPid)) onClosed(id, e.ctx, 'Browser process died (detected by health monitor)');
  }, intervalMs);
  healthTimer.unref?.();
}
export const stopHealthMonitor = () => { if (healthTimer) clearInterval(healthTimer); healthTimer = null; };

export async function stop(id, { timeoutMs = 5000 } = {}) {
  if (launching.has(id)) await launching.get(id).catch(() => {});
  const e = live.get(id) || settling.get(id);
  if (!e) { db.prepare('DELETE FROM running WHERE id=?').run(id); return; }
  e.stopping = true;
  if (!live.has(id)) { if (e.done) await e.done; return; }
  // 1) graceful: close the context  2) force: kill the process tree
  await Promise.race([e.ctx.close().catch(() => {}), new Promise(r => setTimeout(r, timeoutMs))]);
  if (e.browserPid && isAlive(e.browserPid)) await killTree(e.browserPid, { expect: userDataDir(id) });
  if (e.done) await e.done;
  else await onClosed(id, e.ctx);
}
export async function shutdown() {
  stopHealthMonitor();
  // Parallel close, each bounded, so a stuck browser cannot hold shutdown open.
  await Promise.all(runningIds().map(id => stop(id, { timeoutMs: 10000 })));
}
