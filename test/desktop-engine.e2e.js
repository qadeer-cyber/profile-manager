// Desktop engine e2e (owner: Windows Desktop Engineer). Real Chromium, in-process engine:
// CDP off by default, opt-in automation, pid tracking without CDP, cmdline-verified orphan recovery,
// CHROMIUM_MISSING structured error. Linux run only; Windows equivalents are in docs/WINDOWS_BUILD.md.
import fs from 'fs'; import os from 'os'; import path from 'path'; import net from 'net';
import { spawn } from 'child_process';
import { armWatchdog, trackProcess, killTracked } from './_ports.mjs';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-deske2e-'));
process.env.PM_DATA_DIR = path.join(tmp, 'data'); delete process.env.PM_AUTOMATION_DEFAULT;
const { db, userDataDir } = await import('../server/db.js');
const eng = await import('../server/browsers.js');
const { processCommandLine, isAlive } = await import('../server/proc.js');
const { chromium } = await import('playwright');
armWatchdog(12 * 60 * 1000, { beforeExit: () => eng.shutdown() });
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} - ${m}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mk = name => { const id = crypto.randomUUID(), t = new Date().toISOString(); db.prepare('INSERT INTO profiles (id,name,created_at,updated_at) VALUES (?,?,?,?)').run(id, name, t, t); return { id, proxy: null }; };
const portOpen = port => new Promise(r => { const s = net.connect(port, '127.0.0.1', () => { s.destroy(); r(true); }).on('error', () => r(false)); });
try {
  // 1) default: no debugging port
  const A = mk('A'); let ri = await eng.launch(A, { headless: true });
  const cl = await processCommandLine(ri.pid) || '';
  ok(ri.pid && isAlive(ri.pid), 'launch without automation: browser pid tracked (via pipe CDP session)');
  ok(!/remote-debugging-port/.test(cl) && cl.includes(userDataDir(A.id)), 'launch without automation: no --remote-debugging-port in browser cmdline');
  ok(ri.cdp_port === null && ri.ws_endpoint === null, 'running row has cdp_port/ws_endpoint = null when automation is off');
  const lk = JSON.parse(fs.readFileSync(path.join(userDataDir(A.id), '.pm-lock'), 'utf8'));
  ok(lk.browserPid === ri.pid && lk.cdpPort === null, 'lock records browserPid, cdpPort null');
  await eng.onClosed(A.id, { stale: true }, 'stale context');
  const still = eng.runInfo(A.id);
  const lkStale = JSON.parse(fs.readFileSync(path.join(userDataDir(A.id), '.pm-lock'), 'utf8'));
  ok(eng.isRunning(A.id) && still?.pid === ri.pid && isAlive(ri.pid) && lkStale.browserPid === ri.pid, 'a close for a different context leaves the live launch, its lock, and its running row');
  await eng.stop(A.id); ok(!isAlive(ri.pid) && !eng.isRunning(A.id), 'stop works without CDP');
  // 2) opt-in automation
  const B = mk('B'); ri = await eng.launch(B, { headless: true, automation: true });
  ok(ri.cdp_port && await portOpen(ri.cdp_port) && /^ws:\/\/127\.0\.0\.1:/.test(ri.ws_endpoint), 'automation:true exposes CDP on 127.0.0.1');
  const br = await chromium.connectOverCDP(ri.ws_endpoint); ok(br.contexts().length >= 1, 'connectOverCDP works when automation is on'); await br.close();
  await eng.stop(B.id);
  // 3) recovery without CDP: orphan killed (cmdline matches), decoy with reused-looking pid spared
  const C = mk('C'), cDir = userDataDir(C.id); fs.mkdirSync(cDir, { recursive: true });
  const orphan = trackProcess(spawn(chromium.executablePath(), ['--headless=new', `--user-data-dir=${cDir}`, '--no-first-run', 'about:blank'], { detached: true, stdio: 'ignore' }));
  const D = mk('D'), dDir = userDataDir(D.id); fs.mkdirSync(dDir, { recursive: true });
  const decoy = trackProcess(spawn('sleep', ['60'], { detached: true, stdio: 'ignore' })); await sleep(1500);
  const ins = db.prepare('INSERT INTO running VALUES (?,?,?,?,?,?)');
  ins.run(C.id, orphan.pid, null, null, null, 'x'); ins.run(D.id, decoy.pid, null, null, null, 'x');
  for (const [d, pid] of [[cDir, orphan.pid], [dDir, decoy.pid]]) fs.writeFileSync(path.join(d, '.pm-lock'), JSON.stringify({ ownerPid: 2 ** 22 + 991, browserPid: pid, cdpPort: null, startedAt: 'x', host: os.hostname() }));
  const rep = await eng.recoverAfterRestart(); await sleep(300);
  ok(!isAlive(orphan.pid) && rep.killed === 1, `recovery killed the CDP-less orphan (verified by user-data-dir in cmdline) ${JSON.stringify(rep)}`);
  ok(isAlive(decoy.pid), 'recovery did NOT kill an unrelated process holding a recorded pid');
  ok(db.prepare('SELECT COUNT(*) n FROM running').get().n === 0 && !fs.existsSync(path.join(cDir, '.pm-lock')), 'running rows and stale locks cleared');
  process.kill(decoy.pid);
  // 4) no Chromium installed -> CHROMIUM_MISSING
  const saved = process.env.PLAYWRIGHT_BROWSERS_PATH; process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(tmp, 'no-browsers');
  const E = mk('E'); let e1 = null; try { await eng.launch(E, { headless: false }); } catch (e) { e1 = e; }
  ok(e1?.code === 'CHROMIUM_MISSING' && e1.status === 503 && /Download Chromium/.test(e1.message), `no Chromium -> structured CHROMIUM_MISSING (${e1?.code}: ${e1?.message?.slice(0, 60)})`);
  ok(!fs.existsSync(path.join(userDataDir(E.id), '.pm-lock')) && !eng.isRunning(E.id), 'failed launch released the lock');
  if (saved === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH; else process.env.PLAYWRIGHT_BROWSERS_PATH = saved;
} catch (e) { fail++; console.log('FAIL - exception', e); }
finally {
  await eng.shutdown();
  killTracked();
  console.log(`\ndesktop-engine e2e: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
