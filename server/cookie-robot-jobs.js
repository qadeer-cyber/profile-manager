// CookieRobot-local: user-authorized URL batches only (no CAPTCHA/abuse automation).
import crypto from 'crypto';
import { chromium } from 'playwright';
import { db } from './db.js';
import * as engine from './browsers.js';

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const URL_RE = /^https?:\/\/.+/i;
const BLOCKED_HOSTS = /^(accounts\.google\.|google\.com\/recaptcha|www\.google\.com\/recaptcha)/i;

const runners = new Map();
let launchProfileFn = null;

export function configureCookieRobot({ launchProfile }) {
  launchProfileFn = launchProfile;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createCookieRobotJob({ profileId, urls, delayMs = 1500 }) {
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

export function retryCookieRobotJob(id) {
  const job = getCookieRobotJob(id);
  if (job.status === 'running') throw fail(409, 'job is still running', 'JOB_RUNNING');
  const tasks = job.tasks.map(t => ({ ...t, status: t.status === 'ok' ? 'ok' : 'pending', error: t.status === 'ok' ? null : t.error }));
  persistTasks(id, tasks, 'queued');
  const control = { cancel: false };
  runners.set(id, control);
  setImmediate(() => runCookieRobotJob(id, control).catch(() => {}));
  return getCookieRobotJob(id);
}

async function runCookieRobotJob(id, control) {
  const row = db.prepare('SELECT * FROM cookie_robot_jobs WHERE id=?').get(id);
  if (!row) return;
  let tasks = JSON.parse(row.tasks_json || '[]');
  persistTasks(id, tasks, 'running');
  const profileId = row.profile_id;
  const delayMs = Number(row.delay_ms) || 1500;
  let browser = null;
  try {
    const profileRow = db.prepare('SELECT browser_engine FROM profiles WHERE id=? AND deleted_at IS NULL').get(profileId);
    if (!profileRow) throw fail(404, 'Profile not found', 'NOT_FOUND');
    if (profileRow.browser_engine === 'firefox') throw fail(501, 'CookieRobot-local currently supports Chromium automation (CDP) only', 'FIREFOX_UNSUPPORTED');
    if (!engine.isRunning(profileId)) {
      if (!launchProfileFn) throw fail(500, 'CookieRobot launch is not configured', 'INTERNAL');
      await launchProfileFn(profileId);
    }
    const info = engine.runInfo(profileId);
    if (!info?.cdp_port) throw fail(409, 'Profile must run with automation (CDP). Native manual launches cannot run CookieRobot jobs.', 'NO_CDP');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${info.cdp_port}`);
    const context = browser.contexts()[0] || await browser.newContext();
    for (let i = 0; i < tasks.length; i++) {
      if (control.cancel) { persistTasks(id, tasks, 'cancelled'); return; }
      if (tasks[i].status === 'ok') continue;
      const page = context.pages()[0] || await context.newPage();
      try {
        await page.goto(tasks[i].url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        tasks[i] = { ...tasks[i], status: 'ok', error: null, at: new Date().toISOString() };
      } catch (error) {
        tasks[i] = { ...tasks[i], status: 'failed', error: error.message, at: new Date().toISOString() };
      }
      persistTasks(id, tasks, 'running');
      if (i < tasks.length - 1) await new Promise(r => setTimeout(r, delayMs));
    }
    const failed = tasks.some(t => t.status === 'failed');
    persistTasks(id, tasks, failed ? 'failed' : 'done', failed ? 'one or more URLs failed' : null);
  } catch (error) {
    persistTasks(id, tasks, 'failed', error.message || 'job failed');
  } finally {
    runners.delete(id);
    try { await browser?.close(); } catch {}
  }
}
