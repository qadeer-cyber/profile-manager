// CookieRobot-local: user-authorized URL batches only (no CAPTCHA/abuse automation).
import crypto from 'crypto';
import { chromium } from 'playwright';
import { db } from './db.js';
import * as engine from './browsers.js';

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const URL_RE = /^https?:\/\/.+/i;
const BLOCKED_HOSTS = /^(accounts\.google\.|google\.com\/recaptcha|www\.google\.com\/recaptcha)/i;
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
  if (!Array.isArray(urls) || !urls.length || urls.length > 30) throw fail(400, 'urls must be an array of 1-30 http(s) URLs', 'INVALID_URLS');
  return urls.map(u => {
    const url = String(u || '').trim();
    if (!URL_RE.test(url)) throw fail(400, `Invalid URL: ${url.slice(0, 80)}`, 'INVALID_URLS');
    let host;
    try { host = new URL(url).hostname; } catch { throw fail(400, 'Invalid URL', 'INVALID_URLS'); }
    if (BLOCKED_HOSTS.test(host)) throw fail(400, 'This job runner does not target Google CAPTCHA or account flows', 'URL_NOT_ALLOWED');
    return url;
  });
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

export function createCookieRobotJob({ profileId, urls, delayMs = 1500 }) {
  assertChromiumProfile(profileId);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const list = parseUrls(urls);
  const delay = Math.min(10000, Math.max(500, Number(delayMs) || 1500));
  const tasks = list.map(url => ({ url, status: 'pending', error: null, at: null }));
  db.prepare('INSERT INTO cookie_robot_jobs (id,profile_id,status,tasks_json,delay_ms,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, profileId, 'queued', JSON.stringify(tasks), delay, null, now, now);
  const control = { cancel: false };
  runners.set(id, control);
  setImmediate(() => runCookieRobotJob(id, control).catch(() => {}));
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
  const control = runners.get(id);
  if (control) control.cancel = true;
  const job = getCookieRobotJob(id);
  if (job.status === 'running' || job.status === 'queued') persistTasks(id, job.tasks, 'cancelled');
  return getCookieRobotJob(id);
}

export function retryCookieRobotJob(id, { failedOnly = false } = {}) {
  const job = getCookieRobotJob(id);
  if (job.status === 'running') throw fail(409, 'job is still running', 'JOB_RUNNING');
  const tasks = job.tasks.map(t => {
    if (t.status === 'ok') return t;
    if (failedOnly && t.status !== 'failed') return t;
    return { ...t, status: 'pending', error: null, at: null };
  });
  persistTasks(id, tasks, 'queued');
  const control = { cancel: false };
  runners.set(id, control);
  setImmediate(() => runCookieRobotJob(id, control).catch(() => {}));
  return getCookieRobotJob(id);
}

async function waitForCdpPort(profileId, timeoutMs = CDP_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = engine.runInfo(profileId);
    if (info?.cdp_port) return info.cdp_port;
    if (!engine.isRunning(profileId)) break;
    await new Promise(r => setTimeout(r, 200));
  }
  throw fail(409, 'Timed out waiting for automation CDP on the profile. Enable automation on the profile or retry.', 'NO_CDP');
}

async function connectCdpWithRetry(cdpPort) {
  const url = `http://127.0.0.1:${cdpPort}`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await chromium.connectOverCDP(url);
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw fail(503, `CDP connect failed: ${lastErr?.message || lastErr}`, 'CDP_CONNECT_FAILED');
}

async function runCookieRobotJob(id, control) {
  const row = db.prepare('SELECT * FROM cookie_robot_jobs WHERE id=?').get(id);
  if (!row) return;
  let tasks = JSON.parse(row.tasks_json || '[]');
  persistTasks(id, tasks, 'running');
  const profileId = row.profile_id;
  const delayMs = Number(row.delay_ms) || 1500;
  let browser = null;
  let launchedByJob = false;
  try {
    assertChromiumProfile(profileId);
    if (!engine.isRunning(profileId)) {
      if (!launchProfileFn) throw fail(500, 'CookieRobot launch is not configured', 'INTERNAL');
      await launchProfileFn(profileId);
      launchedByJob = true;
    } else {
      const info = engine.runInfo(profileId);
      if (!info?.cdp_port) {
        throw fail(409, 'Profile is running without automation (CDP). Stop it and start a job again to launch with automation, or enable automation on the profile.', 'NO_CDP');
      }
    }
    const cdpPort = await waitForCdpPort(profileId);
    browser = await connectCdpWithRetry(cdpPort);
    const context = browser.contexts()[0] || await browser.newContext();
    for (let i = 0; i < tasks.length; i++) {
      if (control.cancel) { persistTasks(id, tasks, 'cancelled'); return; }
      if (tasks[i].status === 'ok') continue;
      let page;
      try {
        page = await context.newPage();
        await page.goto(tasks[i].url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        tasks[i] = { ...tasks[i], status: 'ok', error: null, at: new Date().toISOString() };
      } catch (error) {
        tasks[i] = { ...tasks[i], status: 'failed', error: error.message, at: new Date().toISOString() };
      } finally {
        try { await page?.close(); } catch {}
      }
      persistTasks(id, tasks, 'running');
      if (i < tasks.length - 1 && !control.cancel) await new Promise(r => setTimeout(r, delayMs));
    }
    const failed = tasks.some(t => t.status === 'failed');
    persistTasks(id, tasks, failed ? 'failed' : 'done', failed ? 'one or more URLs failed' : null);
  } catch (error) {
    persistTasks(id, tasks, 'failed', error.message || 'job failed');
  } finally {
    runners.delete(id);
    if (browser) {
      try {
        // connectOverCDP: close() detaches Playwright; browser process keeps running.
        await browser.close();
      } catch { /* ignore */ }
    }
    if (launchedByJob && control.cancel) {
      try { await engine.stop(profileId, { timeoutMs: 15000 }); } catch { /* best effort */ }
    }
  }
}
