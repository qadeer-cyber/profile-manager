// Authorized UI-testing keystroke emulation over Chromium CDP (no CAPTCHA/account bypass).
import { chromium } from 'playwright';
import { db } from './db.js';
import * as engine from './browsers.js';

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const MAX_TEXT = 4096;

export function humanInputReport() {
  return {
    generatedAt: new Date().toISOString(),
    supportedEngines: ['chromium'],
    firefox: { supported: false, reason: 'Human input uses Chromium CDP Input; use geckodriver Send Keys for Firefox automation.' },
    maxLength: MAX_TEXT,
    note: 'For authorized UI testing and accessibility workflows only. Requires a running automation (CDP) session.',
  };
}

function assertChromiumProfile(profileId) {
  const row = db.prepare('SELECT browser_engine FROM profiles WHERE id=? AND deleted_at IS NULL').get(profileId);
  if (!row) throw fail(404, 'Profile not found', 'NOT_FOUND');
  if (row.browser_engine === 'firefox') {
    throw fail(501, 'Human input supports Chromium CDP profiles only.', 'FIREFOX_UNSUPPORTED');
  }
}

function delayMsFromWpm(wpm) {
  const w = Math.min(600, Math.max(20, Number(wpm) || 180));
  const msPerChar = Math.round(60000 / (w * 5));
  return Math.min(500, Math.max(15, msPerChar));
}

/** @param {number} cdpPort @param {string} text @param {{ wpm?: number, jitterMs?: number, selector?: string, signal?: { cancel?: boolean } }} opts */
export async function typeHumanTextOverCdp(cdpPort, text, { wpm = 180, jitterMs = 35, selector, signal = {} } = {}) {
  const payload = String(text ?? '');
  if (!payload.length || payload.length > MAX_TEXT) throw fail(400, `text must be 1-${MAX_TEXT} characters`, 'INVALID_TEXT');
  const baseDelay = delayMsFromWpm(wpm);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  try {
    const context = browser.contexts()[0] || await browser.newContext();
    const pages = context.pages().filter(p => !p.isClosed());
    const page = pages[0] || await context.newPage();
    if (selector) {
      await page.focus(selector);
    } else {
      try { await page.focus('body'); } catch { /* best effort */ }
    }
    let typed = 0;
    for (const char of payload) {
      if (signal.cancel) throw fail(409, 'Typing cancelled', 'TYPING_CANCELLED');
      const jitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
      const delay = baseDelay + jitter;
      if (char === '\n') await page.keyboard.press('Enter', { delay });
      else if (char === '\t') await page.keyboard.press('Tab', { delay });
      else await page.keyboard.type(char, { delay });
      typed++;
    }
    return { typed, wpm, delayMs: baseDelay };
  } finally {
    try { await browser.close(); } catch { /* detach only */ }
  }
}

export async function typeHumanTextForProfile(profileId, text, opts = {}) {
  assertChromiumProfile(profileId);
  if (!engine.isRunning(profileId)) throw fail(409, 'Profile must be running with automation (CDP).', 'NOT_RUNNING');
  const info = engine.runInfo(profileId);
  if (!info?.cdp_port) throw fail(409, 'Profile is running without CDP. Enable automation and relaunch.', 'NO_CDP');
  const result = await typeHumanTextOverCdp(info.cdp_port, text, opts);
  return { profileId, ...result };
}
