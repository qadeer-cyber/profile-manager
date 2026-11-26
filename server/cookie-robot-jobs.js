// CookieRobot-local: user-authorized URL batches only (no CAPTCHA/abuse automation).
import crypto from 'crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { db } from './db.js';
import * as engine from './browsers.js';
import { validateCookieRobotUrlList, validateCookieRobotUrl } from './cookie-robot-url.js';

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const CDP_WAIT_MS = 45000;

const runners = new Map();
let launchProfileFn = null;

export function configureCookieRobot({ launchProfile }) {
  launchProfileFn = launchProfile;
}

export function cookieRobotReport() {
  return {
    generatedAt: new Date().toISOString(),
    supportedEngines: ['chromium'],
    firefox: { supported: false, reason: 'CookieRobot-local uses Chromium CDP (connectOverCDP). Firefox marionette warming is not implemented.' },
    requiresAutomationSession: true,
    note: 'Profiles must run with automation (CDP). Manual native launches cannot run jobs. User-supplied http(s) URLs only.',
    blockedPatterns: ['Google account sign-in hosts', 'Google reCAPTCHA hosts'],
  };
}

function assertChromiumProfile(profileId) {
  const profileRow = db.prepare('SELECT browser_engine FROM profiles WHERE id=? AND deleted_at IS NULL').get(profileId);
  if (!profileRow) throw fail(404, 'Profile not found', 'NOT_FOUND');
  if (profileRow.browser_engine === 'firefox') {
    throw fail(501, 'CookieRobot-local supports Chromium automation (CDP) only. Firefox profiles are not supported.', 'FIREFOX_UNSUPPORTED');
  }
  return profileRow;
}

function parseUrls(urls) {
  return validateCookieRobotUrlList(urls);
}

function rowToJob(row) {
  if (!row) return null;
  let tasks = [];
  try { tasks = JSON.parse(row.tasks_json || '[]'); } catch { tasks = []; }
  return {
    id: row.id,
    profileId: row.profile_id,
    status: row.status,
    tasks,
    error: row.error || null,
    delayMs: row.delay_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function scheduleJob(id) {
  const controller = new AbortController();
  runners.set(id, controller);
  setImmediate(async () => {
    try { if (db.open) await runCookieRobotJob(id, controller.signal); }
    finally { runners.delete(id); }
  });
}

export function createCookieRobotJob({ profileId, urls, delayMs = 1500 }) {
  assertChromiumProfile(profileId);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const list = parseUrls(urls);
  const delay = Math.min(10000, Math.max(500, Number(delayMs) || 1500));
  const tasks = list.map(url => ({ url, status: 'pending', error: null, at: null }));
  db.prepare('INSERT INTO cookie_robot_jobs (id,profile_id,status,tasks_json,delay_ms,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, profileId, 'queued', JSON.stringify(tasks), delay, null, now, now);
  scheduleJob(id);
  return getCookieRobotJob(id);
}

export function getCookieRobotJob(id) {
  const job = rowToJob(db.prepare('SELECT * FROM cookie_robot_jobs WHERE id=?').get(id));
  if (!job) throw fail(404, 'job not found', 'NOT_FOUND');
  return job;
}

export function listCookieRobotJobs(limit = 20) {
  const n = Math.min(50, Math.max(1, Number(limit) || 20));
  return db.prepare('SELECT * FROM cookie_robot_jobs ORDER BY created_at DESC LIMIT ?').all(n).map(rowToJob);
}

function persistTasks(id, tasks, status, error = null) {
  db.prepare('UPDATE cookie_robot_jobs SET tasks_json=?, status=?, error=?, updated_at=? WHERE id=?')
    .run(JSON.stringify(tasks), status, error, new Date().toISOString(), id);
}

export function cancelCookieRobotJob(id) {
  const r = runners.get(id);
  r?.abort();
  const job = getCookieRobotJob(id);
  if (job.status === 'running' || job.status === 'queued') persistTasks(id, job.tasks, 'cancelled');
  return getCookieRobotJob(id);
}

export function retryCookieRobotJob(id, { failedOnly = false } = {}) {
  const job = getCookieRobotJob(id);
  if (runners.has(id) || job.status === 'running') throw fail(409, 'job is still running', 'JOB_RUNNING');
  const tasks = job.tasks.map(t => {
    if (t.status === 'ok') return t;
    if (failedOnly && t.status !== 'failed') return t;
    return { ...t, status: 'pending', error: null, at: null };
  });
  persistTasks(id, tasks, 'queued');
  scheduleJob(id);
  return getCookieRobotJob(id);
}

async function waitForCdpPort(profileId, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const info = engine.runInfo(profileId);
    if (info?.cdp_port) return info.cdp_port;
    if (!engine.isRunning(profileId)) break;
    await delay(200, undefined, { signal });
  }
  throw fail(409, 'Timed out waiting for automation CDP on the profile. Enable automation on the profile or retry.', 'NO_CDP');
}

async function gotoCookieRobotUrl(page, url, signal) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      return;
    } catch (e) {
      lastErr = e;
      if (!String(e.message || e).includes('ERR_ABORTED') || attempt === 2) throw e;
      await delay(250 * (attempt + 1), undefined, { signal });
    }
  }
  throw lastErr;
}

/** Testable CDP task runner (real Chromium CDP when port is live). */
export async function runCookieRobotTasksOverCdp(cdpPort, tasks, { delayMs = 500, signal = new AbortController().signal, validateFinalUrl = true, onProgress = () => {} } = {}) {
  const browser = await connectCdpWithRetry(cdpPort, signal);
  try {
    const context = browser.contexts()[0];
    if (!context) throw fail(409, 'Profile context closed', 'NO_CDP');
    const out = [...tasks];
    for (let i = 0; i < tasks.length && !signal.aborted; i++) {
      if (tasks[i].status === 'ok') continue;
      let page, closing;
      const closePage = () => { if (page) closing ??= page.close().catch(() => {}); };
      try {
        page = await context.newPage();
        signal.addEventListener('abort', closePage, { once: true });
        signal.throwIfAborted();
        let redirectBlocked;
        page.on('framenavigated', frame => {
          if (frame !== page.mainFrame()) return;
          try { validateCookieRobotUrl(frame.url(), { afterRedirect: true }); }
          catch (e) { redirectBlocked = e.message; }
        });
        await gotoCookieRobotUrl(page, tasks[i].url, signal);
        signal.throwIfAborted();
        if (redirectBlocked) throw fail(400, redirectBlocked, 'URL_NOT_ALLOWED');
        if (validateFinalUrl) validateCookieRobotUrl(page.url(), { afterRedirect: true });
        out[i] = { ...tasks[i], status: 'ok', error: null, at: new Date().toISOString() };
      } catch (error) {
        if (signal.aborted) break;
        out[i] = { ...tasks[i], status: 'failed', error: error.message, at: new Date().toISOString() };
      } finally {
        signal.removeEventListener('abort', closePage);
        closePage();
        await closing;
      }
      if (!signal.aborted) onProgress(out);
      if (i < tasks.length - 1) {
        try { await delay(delayMs, undefined, { signal }); }
        catch (e) { if (!signal.aborted) throw e; }
      }
    }
    return out;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function connectCdpWithRetry(cdpPort, signal) {
  const url = `http://127.0.0.1:${cdpPort}`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    try {
      return await chromium.connectOverCDP(url, { timeout: 5000 });
    } catch (e) {
      lastErr = e;
      await delay(300 * (attempt + 1), undefined, { signal });
    }
  }
  throw fail(503, `CDP connect failed: ${lastErr?.message || lastErr}`, 'CDP_CONNECT_FAILED');
}

async function runCookieRobotJob(id, signal) {
  const row = db.prepare('SELECT * FROM cookie_robot_jobs WHERE id=?').get(id);
  if (!row) return;
  if (signal.aborted) {
    persistTasks(id, JSON.parse(row.tasks_json || '[]'), 'cancelled');
    return;
  }
  let tasks = JSON.parse(row.tasks_json || '[]');
  persistTasks(id, tasks, 'running');
  const profileId = row.profile_id;
  const delayMs = Number(row.delay_ms) || 1500;
  let launchedByJob = false;
  try {
    if (signal.aborted) {
      persistTasks(id, tasks, 'cancelled');
      return;
    }
    assertChromiumProfile(profileId);
    if (!engine.isRunning(profileId)) {
      if (signal.aborted) { persistTasks(id, tasks, 'cancelled'); return; }
      if (!launchProfileFn) throw fail(500, 'CookieRobot launch is not configured', 'INTERNAL');
      await launchProfileFn(profileId);
      launchedByJob = true;
    } else {
      const info = engine.runInfo(profileId);
      if (!info?.cdp_port) {
        throw fail(409, 'Profile is running without automation (CDP). Stop it and start a job again to launch with automation, or enable automation on the profile.', 'NO_CDP');
      }
    }
    const cdpPort = await waitForCdpPort(profileId, CDP_WAIT_MS, signal);
    if (signal.aborted) {
      persistTasks(id, tasks, 'cancelled');
      return;
    }
    tasks = await runCookieRobotTasksOverCdp(cdpPort, tasks, { delayMs, signal, onProgress: progress => persistTasks(id, progress, 'running') });
    if (signal.aborted) {
      persistTasks(id, tasks, 'cancelled');
      return;
    }
    const failed = tasks.some(t => t.status === 'failed');
    persistTasks(id, tasks, failed ? 'failed' : 'done', failed ? 'one or more URLs failed' : null);
  } catch (error) {
    if (error.code === 'JOB_CANCELLED' || signal.aborted) persistTasks(id, tasks, 'cancelled');
    else persistTasks(id, tasks, 'failed', error.message || 'job failed');
  } finally {
    if (launchedByJob && signal.aborted) {
      try { await engine.stop(profileId, { timeoutMs: 15000 }); } catch { /* best effort */ }
    }
  }
}
