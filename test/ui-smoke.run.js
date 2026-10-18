// Runs web/e2e/ui-smoke.mjs (UI/UX) against temp servers in web mode. Ports are OS-assigned unless
// PM_TEST_PORT (main server) / PM_TEST_NOCHROME_PORT (server with no Chromium installed) are set.
// Screenshots go to OUT_DIR (a temp dir in CI) when that env var is set.
import { spawn } from 'child_process'; import fs from 'fs'; import os from 'os'; import path from 'path';
import { spawnServer, stopServer, armWatchdog, trackProcess, killTracked } from './_ports.mjs';
armWatchdog(15 * 60 * 1000);
const smoke = 'web/e2e/ui-smoke.mjs';
if (!fs.existsSync(smoke)) { console.log('FAIL ui-smoke: ' + smoke + ' not present'); process.exit(1); }
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ui-')), noDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ui-nochrome-'));
const base = { ...process.env, HEADLESS: '1', PM_API_TOKEN: 'ui-api', PM_PROXY_LOOPBACK: '1' };
delete base.PM_UI_TOKEN;
const outDir = process.env.OUT_DIR
  ? (process.env.OUT_DIR.endsWith(path.sep) || process.env.OUT_DIR.endsWith('/') ? process.env.OUT_DIR : process.env.OUT_DIR + path.sep)
  : dataDir + path.sep;
let srv, nochrome, code = 1;
try {
  srv = await spawnServer({ ...base, PM_DATA_DIR: dataDir });
  // Second server whose Playwright browser cache is an empty dir, so launches return 503 CHROMIUM_MISSING.
  const emptyBrowsers = path.join(noDir, 'browsers'); fs.mkdirSync(emptyBrowsers);
  nochrome = await spawnServer({ ...base, PM_DATA_DIR: noDir, PLAYWRIGHT_BROWSERS_PATH: emptyBrowsers }, { envName: 'PM_TEST_NOCHROME_PORT' });
  fs.mkdirSync(outDir, { recursive: true });
  const t = trackProcess(spawn(process.execPath, [smoke], { env: { ...process.env, PM_URL: srv.url, PM_URL_NOCHROME: nochrome.url, OUT_DIR: outDir }, stdio: 'inherit' }));
  code = await new Promise(r => t.on('exit', r));
} catch (e) { console.error(e); code = 1; }
finally {
  if (srv) await stopServer(srv);
  if (nochrome) await stopServer(nochrome);
  killTracked();
  process.exit(code ?? 1);
}
