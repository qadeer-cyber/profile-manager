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

export function humanInputReport() {
  return {
    generatedAt: new Date().toISOString(),
    supportedEngines: ['chromium', 'firefox'],
    chromium: { transport: 'cdp', requires: ['running profile', 'automation (CDP port)'] },
    firefox: {
      supported: true,
      transport: 'geckodriver',
      requires: ['running profile', 'automation (-marionette)', 'geckodriver on PATH or PM_GECKODRIVER_PATH'],
      note: 'Uses W3C WebDriver key actions via geckodriver — not CDP.',
    },
    maxLength: MAX_TEXT,
    wpmRange: { min: 20, max: 600 },
    specialKeys: SPECIAL_KEY_NAMES,
    specialKeySyntax: 'Embed {Enter}, {Tab}, {Escape}, etc. in text',
    cancelEndpoint: 'POST /api/profiles/:id/human-input/cancel',
    activeSessions: [...activeJobs.keys()],
    note: 'For authorized UI testing and accessibility workflows only.',
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
  const baseDelay = delayMsFromWpm(norm.wpm);
  const segments = parseHumanInputSegments(payload);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  try {
    const context = browser.contexts()[0] || await browser.newContext();
    const pages = context.pages().filter(p => !p.isClosed());
    const page = pages[0] || await context.newPage();
    await focusTarget(page, norm.selector);
    let typed = 0;
    for (const seg of segments) {
      assertNotCancelled(norm.signal);
      const jitter = norm.jitterMs > 0 ? Math.floor(Math.random() * norm.jitterMs) : 0;
      const delay = baseDelay + jitter;
      if (seg.type === 'key') await page.keyboard.press(seg.value, { delay });
      else if (seg.value === '\n') await page.keyboard.press('Enter', { delay });
      else if (seg.value === '\t') await page.keyboard.press('Tab', { delay });
      else await page.keyboard.type(seg.value, { delay });
      typed++;
    }
    return { typed, wpm: norm.wpm ?? 180, delayMs: baseDelay, transport: 'cdp', deterministic: norm.jitterMs === 0 };
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
  const baseDelay = delayMsFromWpm(norm.wpm);
  const segments = parseHumanInputSegments(payload);
  const session = await webDriverJson(webdriverUrl, '/session', 'POST', {
    capabilities: { alwaysMatch: { browserName: 'firefox' } },
  });
  const sessionId = session?.value?.sessionId;
  if (!sessionId) throw fail(503, 'Geckodriver did not return a session id', 'WEBDRIVER_ERROR');
  try {
    let typed = 0;
    for (const seg of segments) {
      assertNotCancelled(norm.signal);
      const jitter = norm.jitterMs > 0 ? Math.floor(Math.random() * norm.jitterMs) : 0;
      const delay = baseDelay + jitter;
      const value = seg.type === 'key' ? seg.value : seg.value;
      const actions = [{ type: 'pause', duration: delay }];
      if (seg.type === 'key') {
        actions.push({ type: 'keyDown', value }, { type: 'keyUp', value });
      } else {
        actions.push({ type: 'keyDown', value }, { type: 'keyUp', value });
      }
      await webDriverJson(webdriverUrl, `/session/${sessionId}/actions`, 'POST', {
        actions: [{ type: 'key', id: 'keyboard', actions }],
      });
      typed++;
    }
    return { typed, wpm: norm.wpm ?? 180, delayMs: baseDelay, transport: 'geckodriver', deterministic: norm.jitterMs === 0 };
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
