import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { freePort, trackProcess, hardKill } from './_ports.mjs';

export async function startChromiumCdpFixture(t, { url = 'about:blank' } = {}) {
  const exe = chromium.executablePath();
  if (!fs.existsSync(exe)) throw new Error('Pinned Chromium is unavailable; install it with npx playwright install chromium');
  const port = await freePort(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cdp-fixture-'));
  let context, proc;
  t.after(async () => {
    let timer;
    try {
      if (context) await Promise.race([context.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Chromium fixture graceful cleanup timed out')), 5000); })]);
    } finally {
      clearTimeout(timer);
      if (proc && proc.exitCode === null && proc.signalCode === null) hardKill(proc.pid);
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
  // Playwright's pipe launch waits for browser and initial-page initialization.
  // A /json/version websocket alone was insufficient readiness on Windows.
  // The operation under test still attaches independently over this real CDP port.
  context = await chromium.launchPersistentContext(dir, {
    executablePath: exe, headless: true, timeout: 20000,
    args: [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
  });
  const browser = context.browser();
  proc = browser?._connection?.toImpl?.(browser)?.options?.browserProcess?.process;
  if (!proc?.pid) throw Error('Owned Chromium fixture process is unavailable for failure cleanup');
  trackProcess(proc);
  const page = context.pages()[0] || await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
  return { port, endpoint: `http://127.0.0.1:${port}`, context, page };
}
