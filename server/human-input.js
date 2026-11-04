// Authorized UI-testing keystroke emulation (Chromium CDP + Firefox geckodriver). No CAPTCHA/account bypass.
import { chromium } from 'playwright';
import { db } from './db.js';
import * as engine from './browsers.js';
import { startGeckodriverBridge } from './geckodriver-bridge.js';

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const MAX_TEXT = 4096;

/** @type {Map<string, { abort: AbortController }>} */
const activeJobs = new Map();

export const SPECIAL_KEY_NAMES = Object.freeze([
  'Enter', 'Tab', 'Escape', 'Backspace', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End',
]);

const SPECIAL_KEY_TOKEN = new Map(SPECIAL_KEY_NAMES.map(k => [k.toLowerCase(), k]));
const FAST_DIGRAPHS = new Set(['th', 'he', 'in', 'er', 'an', 're', 'on', 'at', 'en', 'nd', 'hi', 'ou', 'ed', 'to', 'it', 'is', 'es', 'or', 'te', 'of']);
const SLOW_CHARS = new Set(['.', ',', '!', '?', ';', ':', '\n']);
export const TIMING_MODEL = 'interkey-wpm-v1';
export const FIREFOX_TIMING_LIMITS = Object.freeze([
  'Firefox timing uses W3C action pause durations only. Keydown timestamps are not read back, so timingMeasured is false.',
  'Stock Firefox has no CDP Input.dispatchKeyEvent path.',
  'Special keys are W3C key values, not Playwright key descriptions.',
  'The geckodriver stub test checks the pause payload. It does not measure a live Firefox keydown clock.',
  'Authorized local UI testing only. This is not a CAPTCHA bypass.',
]);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function buildTimingSchedule(text, opts = {}) {
  const deterministic = !!opts.deterministic;
  const jitterMs = deterministic ? 0 : Math.min(200, Math.max(0, Number(opts.jitterMs ?? 35) || 0));
  const base = delayMsFromWpm(opts.wpm);
  const segments = parseHumanInputSegments(String(text ?? ''));
  const rng = mulberry32(deterministic ? 1 : (Number.isInteger(opts.seed) ? opts.seed : 1));
  const intervalsMs = [];
  let prev = null;
  for (const seg of segments) {
    let factor = 1;
    if (seg.type === 'key') factor = 1.4;
    else if (SLOW_CHARS.has(seg.value)) factor = 1.8;
    else if (prev?.type === 'char' && seg.type === 'char' && FAST_DIGRAPHS.has((prev.value + seg.value).toLowerCase())) factor = 0.75;
    let ms = Math.round(base * factor);
    if (!deterministic && jitterMs > 0) ms += Math.floor(rng() * (jitterMs + 1));
    intervalsMs.push(Math.min(800, Math.max(15, ms)));
    prev = seg;
  }
  return { model: TIMING_MODEL, deterministic, baseDelayMs: base, jitterMs, intervalsMs };
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted || signal?.cancel) {
      reject(fail(409, 'Typing cancelled', 'TYPING_CANCELLED'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(fail(409, 'Typing cancelled', 'TYPING_CANCELLED'));
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

export function humanInputReport() {
  return {
    generatedAt: new Date().toISOString(),
    supportedEngines: ['chromium', 'firefox'],
    timingModel: TIMING_MODEL,
    timingMeasuredEngines: ['chromium'],
    chromium: {
      transport: 'cdp',
      requires: ['running profile', 'automation (CDP port)'],
      timingMeasured: true,
      note: 'Inter-key delays are slept in-process and returned as measuredIntervalsMs.',
    },
    firefox: {
      supported: true,
      transport: 'geckodriver',
      timingMeasured: false,
      requires: ['running profile', 'automation (-marionette)', 'geckodriver on PATH or PM_GECKODRIVER_PATH'],
      note: 'Uses W3C WebDriver key actions via geckodriver — not CDP.',
      limits: FIREFOX_TIMING_LIMITS,
    },
    maxLength: MAX_TEXT,
    wpmRange: { min: 20, max: 600 },
    specialKeys: SPECIAL_KEY_NAMES,
    specialKeySyntax: 'Embed {Enter}, {Tab}, {Escape}, etc. in text',
    cancelEndpoint: 'POST /api/profiles/:id/human-input/cancel',
    activeSessions: [...activeJobs.keys()],
    note: 'Authorized local UI testing only. Not a CAPTCHA or access-control bypass.',
  };
}

export function getHumanInputStatus(profileId) {
  return { profileId, active: activeJobs.has(profileId) };
}

export function cancelHumanInput(profileId) {
  const job = activeJobs.get(profileId);
  if (!job) return { cancelled: false, reason: 'no_active_typing' };
  job.abort.abort();
  return { cancelled: true, profileId };
}

/** Split text into char and special-key segments; supports Unicode code points and {Enter} tokens. */
export function parseHumanInputSegments(text) {
  const payload = String(text ?? '');
  const segments = [];
  const re = /\{([A-Za-z]+)\}/g;
  let last = 0;
  let match;
  while ((match = re.exec(payload))) {
    if (match.index > last) {
      for (const char of [...payload.slice(last, match.index)]) segments.push({ type: 'char', value: char });
    }
    const key = SPECIAL_KEY_TOKEN.get(match[1].toLowerCase());
    if (key) segments.push({ type: 'key', value: key });
    else for (const char of [...match[0]]) segments.push({ type: 'char', value: char });
    last = match.index + match[0].length;
  }
  if (last < payload.length) {
    for (const char of [...payload.slice(last)]) segments.push({ type: 'char', value: char });
  }
  return segments;
}

function assertProfileRow(profileId) {
  const row = db.prepare('SELECT browser_engine FROM profiles WHERE id=? AND deleted_at IS NULL').get(profileId);
  if (!row) throw fail(404, 'Profile not found', 'NOT_FOUND');
  return row;
}

function delayMsFromWpm(wpm) {
  const w = Math.min(600, Math.max(20, Number(wpm) || 180));
  const msPerChar = Math.round(60000 / (w * 5));
  return Math.min(500, Math.max(15, msPerChar));
}

function normalizeOpts(opts = {}) {
  const deterministic = !!opts.deterministic;
  const jitterMs = deterministic ? 0 : Math.min(200, Math.max(0, Number(opts.jitterMs ?? 35) || 0));
  return {
    wpm: opts.wpm,
    jitterMs,
    deterministic,
    seed: opts.seed,
    selector: typeof opts.selector === 'string' && opts.selector.trim() ? opts.selector.trim() : null,
    signal: opts.signal || {},
  };
}

function assertNotCancelled(signal) {
  if (signal?.aborted || signal?.cancel) throw fail(409, 'Typing cancelled', 'TYPING_CANCELLED');
}

async function focusTarget(page, selector) {
  if (selector) {
    await page.waitForSelector(selector, { state: 'visible', timeout: 10000 });
    await page.focus(selector);
    return;
  }
  try { await page.focus('body'); } catch { /* best effort */ }
}

/** @param {number} cdpPort @param {string} text @param {{ wpm?: number, jitterMs?: number, selector?: string, signal?: { aborted?: boolean, cancel?: boolean } }} opts */
export async function typeHumanTextOverCdp(cdpPort, text, opts = {}) {
  const norm = normalizeOpts(opts);
  const payload = String(text ?? '');
  if (!payload.length || payload.length > MAX_TEXT) throw fail(400, `text must be 1-${MAX_TEXT} characters`, 'INVALID_TEXT');
  const segments = parseHumanInputSegments(payload);
  const schedule = buildTimingSchedule(payload, norm);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const measuredIntervalsMs = [];
  try {
    const context = browser.contexts()[0] || await browser.newContext();
    const pages = context.pages().filter(p => !p.isClosed());
    const page = pages[0] || await context.newPage();
    await focusTarget(page, norm.selector);
    for (let i = 0; i < segments.length; i += 1) {
      assertNotCancelled(norm.signal);
      const seg = segments[i];
      const started = Date.now();
      await sleep(schedule.intervalsMs[i], norm.signal);
      if (seg.type === 'key') await page.keyboard.press(seg.value, { delay: 0 });
      else if (seg.value === '\n') await page.keyboard.press('Enter', { delay: 0 });
      else if (seg.value === '\t') await page.keyboard.press('Tab', { delay: 0 });
      else await page.keyboard.type(seg.value, { delay: 0 });
      measuredIntervalsMs.push(Date.now() - started);
    }
    return {
      typed: segments.length,
      wpm: norm.wpm ?? 180,
      delayMs: schedule.baseDelayMs,
      scheduleMs: schedule.intervalsMs,
      measuredIntervalsMs,
      timingModel: TIMING_MODEL,
      timingMeasured: true,
      transport: 'cdp',
      deterministic: !!norm.deterministic,
    };
  } finally {
    try { await browser.close(); } catch { /* detach only */ }
  }
}

async function webDriverJson(baseUrl, path, method, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  }
  if (!response.ok) {
    throw fail(response.status, parsed?.value?.message || parsed?.message || text || `WebDriver HTTP ${response.status}`, 'WEBDRIVER_ERROR');
  }
  return parsed;
}

/** Firefox typing via geckodriver W3C actions (official automation path). */
export async function typeHumanTextOverWebDriver(webdriverUrl, text, opts = {}) {
  const norm = normalizeOpts(opts);
  const payload = String(text ?? '');
  if (!payload.length || payload.length > MAX_TEXT) throw fail(400, `text must be 1-${MAX_TEXT} characters`, 'INVALID_TEXT');
  const segments = parseHumanInputSegments(payload);
  const schedule = buildTimingSchedule(payload, norm);
  const session = await webDriverJson(webdriverUrl, '/session', 'POST', {
    capabilities: { alwaysMatch: { browserName: 'firefox' } },
  });
  const sessionId = session?.value?.sessionId;
  if (!sessionId) throw fail(503, 'Geckodriver did not return a session id', 'WEBDRIVER_ERROR');
  try {
    let typed = 0;
    for (const seg of segments) {
      assertNotCancelled(norm.signal);
      const delay = schedule.intervalsMs[typed];
      const value = seg.value;
      const actions = [
        { type: 'pause', duration: delay },
        { type: 'keyDown', value },
        { type: 'keyUp', value },
      ];
      await webDriverJson(webdriverUrl, `/session/${sessionId}/actions`, 'POST', {
        actions: [{ type: 'key', id: 'keyboard', actions }],
      });
      typed++;
    }
    return {
      typed,
      wpm: norm.wpm ?? 180,
      delayMs: schedule.baseDelayMs,
      scheduleMs: schedule.intervalsMs,
      measuredIntervalsMs: null,
      timingModel: TIMING_MODEL,
      timingMeasured: false,
      transport: 'geckodriver',
      deterministic: !!norm.deterministic,
      firefoxTimingLimits: FIREFOX_TIMING_LIMITS,
    };
  } finally {
    try { await webDriverJson(webdriverUrl, `/session/${sessionId}`, 'DELETE'); } catch { /* ignore */ }
  }
}

export async function typeHumanTextForProfile(profileId, text, opts = {}) {
  const row = assertProfileRow(profileId);
  if (!engine.isRunning(profileId)) throw fail(409, 'Profile must be running with automation.', 'NOT_RUNNING');
  const info = engine.runInfo(profileId);
  const abort = new AbortController();
  activeJobs.set(profileId, { abort });
  const merged = { ...opts, signal: abort.signal };
  try {
    if (row.browser_engine === 'firefox') {
      if (!info?.cdp_port) throw fail(409, 'Firefox must launch with automation (-marionette).', 'NO_MARIONETTE');
      const bridge = await startGeckodriverBridge(profileId, info.cdp_port);
      const result = await typeHumanTextOverWebDriver(bridge.webdriverUrl, text, merged);
      return { profileId, engine: 'firefox', ...result };
    }
    if (!info?.cdp_port) throw fail(409, 'Profile is running without CDP. Enable automation and relaunch.', 'NO_CDP');
    const result = await typeHumanTextOverCdp(info.cdp_port, text, merged);
    return { profileId, engine: 'chromium', ...result };
  } finally {
    activeJobs.delete(profileId);
  }
}
