// Optional localhost ChromeDriver bridge for automation launches only (CDP port open).
import { spawn } from 'node:child_process';
import net from 'node:net';
import { resolveChromedriverForBridge, automationDriversReport } from './automation-drivers.js';

const bridges = new Map();

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    }).on('error', rej);
  });
}

function waitForPort(port, { timeoutMs = 15000 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const sock = net.connect(port, '127.0.0.1');
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) reject(fail(503, 'ChromeDriver did not start listening in time', 'WEBDRIVER_TIMEOUT'));
        else setTimeout(tick, 80);
      });
    };
    tick();
  });
}

export function resolveChromedriverExecutable() {
  return resolveChromedriverForBridge();
}

export function webDriverNewSessionBody(debuggerAddress) {
  if (typeof debuggerAddress !== 'string' || !/^[A-Za-z0-9._-]+:\d{1,5}$/.test(debuggerAddress)) {
    throw fail(400, 'debuggerAddress must look like 127.0.0.1:9222', 'INVALID_WEBDRIVER');
  }
  const port = Number(debuggerAddress.split(':').pop());
  if (port < 1 || port > 65535) throw fail(400, 'debuggerAddress port is out of range', 'INVALID_WEBDRIVER');
  return {
    capabilities: {
      alwaysMatch: {
        browserName: 'chrome',
        'goog:chromeOptions': { debuggerAddress },
      },
    },
  };
}

export function webDriverBridgeReport() {
  const drivers = automationDriversReport();
  return {
    supported: true,
    bundled: false,
    fullParity: false,
    requiresChromedriverOnPath: !drivers.chromedriver.installed,
    configureWith: 'PM_CHROMEDRIVER_PATH',
    optionalCache: drivers.chromedriver,
    attachCapability: 'goog:chromeOptions.debuggerAddress',
    note: 'Only for profiles running with automation (Playwright path + remote-debugging-port). Manual native launches cannot use WebDriver.',
    realPath: {
      env: 'PM_REAL_WEBDRIVER=1',
      test: 'test/webdriver-real.test.js',
      covers: ['session', 'navigate', 'title', 'element', 'unicode value', 'window rect', 'two-profile isolation', 'quit'],
      fullParity: false,
      note: 'Skipped unless PM_REAL_WEBDRIVER=1 and PM_CHROMEDRIVER_PATH are set. A passing stub does not prove a real browser.',
    },
    activeSessions: [...bridges.keys()],
  };
}

export async function startWebDriverBridge(profileId, debuggerAddress) {
  if (!profileId || !debuggerAddress) throw fail(400, 'debuggerAddress is required', 'INVALID_WEBDRIVER');
  const newSession = webDriverNewSessionBody(debuggerAddress);
  const existing = bridges.get(profileId);
  if (existing) return { ...existing.public, reused: true };
  const port = await freePort();
  const executable = resolveChromedriverExecutable();
  let proc;
  const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable);
  try {
    proc = spawn(executable, [`--port=${port}`, '--allowed-ips=127.0.0.1'], {
      stdio: 'ignore',
      windowsHide: true,
      shell,
      env: { ...process.env, PATH: process.env.PATH },
    });
  } catch (error) {
    throw fail(503, `ChromeDriver spawn failed: ${error.message}. Install chromedriver or set PM_CHROMEDRIVER_PATH.`, 'WEBDRIVER_MISSING');
  }
  if (!proc?.pid) throw fail(503, 'ChromeDriver is not installed or not on PATH. Set PM_CHROMEDRIVER_PATH.', 'WEBDRIVER_MISSING');
  proc.on('error', () => { bridges.delete(profileId); });
  proc.on('exit', () => { bridges.delete(profileId); });
  try {
    await waitForPort(port);
  } catch (error) {
    try { proc.kill('SIGTERM'); } catch {}
    bridges.delete(profileId);
    if (error.code === 'WEBDRIVER_TIMEOUT') throw error;
    throw fail(503, 'ChromeDriver failed to start. Install a build matching pinned Chromium.', 'WEBDRIVER_MISSING');
  }
  const publicInfo = {
    profileId,
    webdriverUrl: `http://127.0.0.1:${port}`,
    debuggerAddress,
    newSession,
    sessionHint: {
      'goog:chromeOptions': { debuggerAddress },
    },
  };
  bridges.set(profileId, { proc, port, debuggerAddress, public: publicInfo });
  return { ...publicInfo, reused: false };
}

export function stopWebDriverBridge(profileId) {
  const row = bridges.get(profileId);
  if (!row) return { stopped: false };
  try { row.proc.kill('SIGTERM'); } catch {}
  bridges.delete(profileId);
  return { stopped: true, profileId };
}

export function stopAllWebDriverBridges() {
  for (const id of [...bridges.keys()]) stopWebDriverBridge(id);
}
