// Optional localhost geckodriver bridge — Firefox marionette sessions only.
import { spawn } from 'node:child_process';
import net from 'node:net';
import { resolveGeckodriverForBridge, automationDriversReport } from './automation-drivers.js';

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
        if (Date.now() - start > timeoutMs) reject(fail(503, 'Geckodriver did not start listening in time', 'GECKODRIVER_TIMEOUT'));
        else setTimeout(tick, 80);
      });
    };
    tick();
  });
}

export function resolveGeckodriverExecutable() {
  return resolveGeckodriverForBridge();
}

export function geckodriverBridgeReport() {
  const drivers = automationDriversReport();
  return {
    supported: true,
    bundled: false,
    requiresGeckodriverOnPath: !drivers.geckodriver.installed,
    configureWith: 'PM_GECKODRIVER_PATH',
    optionalCache: drivers.geckodriver,
    note: 'Only for Firefox profiles running with automation:true (-marionette). Chromium uses the ChromeDriver bridge.',
    activeSessions: [...bridges.keys()],
  };
}

export async function startGeckodriverBridge(profileId, marionettePort) {
  if (!profileId || !marionettePort) throw fail(400, 'marionettePort is required', 'INVALID_GECKODRIVER');
  const existing = bridges.get(profileId);
  if (existing) return { ...existing.public, reused: true };
  const port = await freePort();
  const executable = resolveGeckodriverExecutable();
  const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable);
  let proc;
  try {
    proc = spawn(executable, [
      `--port=${port}`,
      '--connect-existing',
      `--marionette-port=${marionettePort}`,
      '--allow-hosts=127.0.0.1',
    ], { stdio: 'ignore', windowsHide: true, shell });
  } catch (error) {
    throw fail(503, `Geckodriver spawn failed: ${error.message}`, 'GECKODRIVER_MISSING');
  }
  if (!proc?.pid) throw fail(503, 'Geckodriver is not installed or not on PATH. Set PM_GECKODRIVER_PATH.', 'GECKODRIVER_MISSING');
  proc.on('exit', () => bridges.delete(profileId));
  try {
    await waitForPort(port);
  } catch (error) {
    try { proc.kill('SIGTERM'); } catch {}
    bridges.delete(profileId);
    throw error;
  }
  const publicInfo = {
    profileId,
    webdriverUrl: `http://127.0.0.1:${port}`,
    marionettePort,
  };
  bridges.set(profileId, { proc, port, marionettePort, public: publicInfo });
  return { ...publicInfo, reused: false };
}

export function stopGeckodriverBridge(profileId) {
  const row = bridges.get(profileId);
  if (!row) return { stopped: false };
  try { row.proc.kill('SIGTERM'); } catch {}
  bridges.delete(profileId);
  return { stopped: true, profileId };
}

export function stopAllGeckodriverBridges() {
  for (const id of [...bridges.keys()]) stopGeckodriverBridge(id);
}
