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
const launching = new Map(); // id -> Promise
export const isRunning = id => live.has(id);
export const runningIds = () => [...live.keys()];
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
  if (live.has(p.id)) return Promise.resolve(runInfo(p.id));
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
    const entry = { ctx, relayUrl, browserPid, stopping: false, closed: false, proc: null, exitCode: null, exitSignal: null };
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

// This Playwright build does not put process() on the Browser client. The in-process
// connection exposes the launched child on the server browser, which is what actually exits.
function browserProcess(ctx) {
  try {
    const browser = ctx.browser?.();
    if (!browser) return null;
    if (typeof browser.process === 'function' && browser.process()) return browser.process();
    const impl = browser._connection?.toImpl?.(browser);
    return impl?.options?.browserProcess?.process || null;
  } catch { return null; }
}
// The Node child exit is the difference between the user closing the last window (code 0)
// and a kill or crash (signal, or a non-zero code). App Stop sets stopping first.
function trackExit(entry) {
  const proc = browserProcess(entry.ctx);
  entry.proc = proc;
  if (!proc) return;
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
function waitExit(entry, ms = 3000) {
  readExit(entry);
  if (entry.exitSignal || entry.exitCode !== null) return Promise.resolve();
  const proc = entry.proc;
  if (!proc) return Promise.resolve();
  // The local SOCKS relay can keep the child-handle 'exit' event behind the
  // window closing. Poll the handle so a late code 0 is still a clean stop.
  return new Promise(resolve => {
    const done = () => { clearInterval(iv); clearTimeout(t); resolve(); };
    const iv = setInterval(() => {
      readExit(entry);
      if (entry.exitSignal || entry.exitCode !== null) done();
    }, 50);
    const t = setTimeout(done, ms);
    proc.once('exit', (code, signal) => {
      entry.exitCode = code;
      entry.exitSignal = signal;
      done();
    });
  });
}
function cleanExit(entry) {
  if (entry.stopping) return true;
  readExit(entry);
  if (entry.exitSignal) return false;
  return entry.exitCode === 0;
}
function crashMessage(entry, reason) {
  readExit(entry);
  const bits = [];
  if (entry.exitSignal) bits.push(`signal ${entry.exitSignal}`);
  else if (typeof entry.exitCode === 'number' && entry.exitCode !== 0) bits.push(`exit code ${entry.exitCode}`);
  const detail = bits.join(', ');
  if (reason && detail) return `${reason} (${detail})`;
  if (reason) return reason;
  if (detail) return `Browser exited unexpectedly (${detail})`;
  return 'Browser exited unexpectedly';
}

async function onClosed(id, ctx, reason) {
  const e = live.get(id);
  if (!e || (ctx && e.ctx !== ctx) || e.closed) return;
  e.closed = true;
  // A user closing the last window drops the process before Playwright's close event
  // carries an exit status. Wait briefly so code 0 is not mistaken for a crash.
  // The SOCKS relay is closed below for both outcomes; it does not decide the outcome.
  if (!e.stopping) await waitExit(e);
  if (live.get(id) !== e) return;
  const crashed = !cleanExit(e);
  // Kill a leftover process before anyone else can launch this profile.
  if (crashed && e.browserPid && isAlive(e.browserPid)) { try { await killTree(e.browserPid, { expect: userDataDir(id) }); } catch {} }
  live.delete(id);
  db.prepare('DELETE FROM running WHERE id=?').run(id);
  try { const dir = userDataDir(id); releaseLock(dir); if (crashed) clearChromeLocks(dir); } catch {}
  // The relay is local bookkeeping. Close it after the row and the lock are gone
  // so a clean window close is already Stopped, including for an authenticated SOCKS proxy.
  if (e.relayUrl) await closeAnonymizedProxy(e.relayUrl, true).catch(() => {});
  if (crashed) {
    const message = crashMessage(e, reason);
    try { setStatus(id, { last_error: message }); } catch {}
    emit('profile:crashed', id, { error: message });
  } else {
    try { setStatus(id, { last_error: null }); } catch {}
  }
  emit('profile:stopped', id);
}

// Health monitor: detects browsers that died without Playwright noticing (e.g. killed externally).
let healthTimer = null;
export function startHealthMonitor(intervalMs = Number(process.env.PM_HEALTH_INTERVAL || 3000)) {
  stopHealthMonitor();
  healthTimer = setInterval(() => {
    for (const [id, e] of live) if (!e.stopping && !e.closed && e.browserPid && !isAlive(e.browserPid)) onClosed(id, e.ctx, 'Browser process died (detected by health monitor)');
  }, intervalMs);
  healthTimer.unref?.();
}
export const stopHealthMonitor = () => { if (healthTimer) clearInterval(healthTimer); healthTimer = null; };

export async function stop(id, { timeoutMs = 5000 } = {}) {
  if (launching.has(id)) await launching.get(id).catch(() => {});
  const e = live.get(id);
  if (!e) { db.prepare('DELETE FROM running WHERE id=?').run(id); return; }
  e.stopping = true;
  // 1) graceful: close the context  2) force: kill the process tree
  await Promise.race([e.ctx.close().catch(() => {}), new Promise(r => setTimeout(r, timeoutMs))]);
  if (e.browserPid && isAlive(e.browserPid)) await killTree(e.browserPid, { expect: userDataDir(id) });
  await onClosed(id, e.ctx);
}
export async function shutdown() {
  stopHealthMonitor();
  // Parallel close, each bounded, so a stuck browser cannot hold shutdown open.
  await Promise.all(runningIds().map(id => stop(id, { timeoutMs: 10000 })));
}
