// Window-close versus crash. A user closing the last window is Stopped.
// A killed browser is Error. One tab closing does not stop the profile.
import http from 'http';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import Database from 'better-sqlite3';
import { chromium } from 'playwright';
import { closeLastPage } from '../electron/smoke-phases.js';
import { listenFree, spawnServer, stopServer, armWatchdog, killTracked, missedGracefulShutdowns } from './_ports.mjs';
armWatchdog(10 * 60 * 1000);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-lifecycle-'));
const target = http.createServer((q, s) => s.end('<title>t</title>ok'));
const ORIGIN = `http://127.0.0.1:${await listenFree(target, 'PM_TEST_TARGET_PORT')}/`;
const socks = net.createServer(c => {
  c.on('error', () => {});
  c.once('data', () => {
    c.write(Buffer.from([5, 2]));
    c.once('data', a => {
      const ul = a[1], u = a.slice(2, 2 + ul).toString(), pl = a[2 + ul], p = a.slice(3 + ul, 3 + ul + pl).toString();
      if (u !== 'alice' || p !== 's3cret') { c.end(Buffer.from([1, 1])); return; }
      c.write(Buffer.from([1, 0]));
      c.once('data', r => {
        let host, i;
        if (r[3] === 1) { host = [...r.slice(4, 8)].join('.'); i = 8; }
        else { host = r.slice(5, 5 + r[4]).toString(); i = 5 + r[4]; }
        const up = net.connect(r.readUInt16BE(i), host, () => {
          c.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          up.pipe(c); c.pipe(up);
        });
        up.on('error', () => c.end());
      });
    });
  });
});
const SOCKS = await listenFree(socks, 'PM_TEST_SOCKS_PORT');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const env = { ...process.env, PM_DATA_DIR: dataDir, HEADLESS: '1', PM_API_TOKEN: 't', PM_HEALTH_INTERVAL: '400', PM_AUTOMATION_DEFAULT: '1' };
delete env.PM_SECRET;
let B, srv;
const api = async (m, u, b) => {
  const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) });
  return { s: r.status, d: r.status === 204 ? null : await r.json() };
};
const lockPath = id => path.join(dataDir, 'profiles', id, '.pm-lock');
function runningRows(id) {
  const file = path.join(dataDir, 'profiles.db');
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try { return db.prepare('SELECT COUNT(*) n FROM running WHERE id=?').get(id).n; }
  finally { db.close(); }
}
function runningPid(id) {
  const file = path.join(dataDir, 'profiles.db');
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try { return db.prepare('SELECT pid FROM running WHERE id=?').get(id)?.pid ?? null; }
  finally { db.close(); }
}
function lockBrowserPid(id) {
  try { return JSON.parse(fs.readFileSync(lockPath(id), 'utf8')).browserPid ?? null; }
  catch { return null; }
}
const evs = [];
let eventsAbort = null;
function startEvents() {
  eventsAbort = new AbortController();
  fetch(B + '/api/events', { signal: eventsAbort.signal }).then(async res => {
    const rd = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = block.split('\n').find(l => l.startsWith('data: '));
        if (line) evs.push(JSON.parse(line.slice(6)));
      }
    }
  }).catch(() => {});
}
const eventCounts = id => ({
  stopped: evs.filter(e => e.type === 'profile:stopped' && e.id === id).length,
  crashed: evs.filter(e => e.type === 'profile:crashed' && e.id === id).length,
});

async function launch(name, extra) {
  const created = await api('POST', '/api/profiles', { name, ...extra });
  if (created.s !== 201) throw new Error('create failed ' + created.s + ' ' + JSON.stringify(created.d));
  // The headless shell never writes profile.exit_type. This suite launches the full
  // browser so a clean quit records Normal and the Windows log can compare both classifiers.
  const started = await api('POST', `/api/profiles/${created.d.id}/launch`, { headless: false });
  if (!started.d?.running) throw new Error('launch failed ' + JSON.stringify(started.d));
  return started.d;
}
async function settled(id) {
  let last = null;
  for (let i = 0; i < 40; i++) {
    last = (await api('GET', `/api/profiles/${id}`)).d;
    if (last && !last.running) return last;
    await sleep(100);
  }
  return last;
}
function stoppedClean(p, pid, label) {
  ok(!!p && !p.running && !p.last_error, `${label}: Stopped with no last_error (${p && p.last_error})`);
  ok(!alive(pid), `${label}: browser process is gone`);
  ok(!!p && !fs.existsSync(lockPath(p.id)), `${label}: lockfile released`);
  ok(!!p && runningRows(p.id) === 0, `${label}: no running row`);
}
function onceEach(id, label, expect) {
  const got = eventCounts(id);
  ok(got.stopped === expect.stopped, `${label}: profile:stopped ${got.stopped} time(s), want ${expect.stopped}`);
  ok(got.crashed === expect.crashed, `${label}: profile:crashed ${got.crashed} time(s), want ${expect.crashed}`);
}
async function connect(profile) {
  return chromium.connectOverCDP(profile.cdp.wsEndpoint);
}
// Target.closeTarget on the last page is the window close. Chromium exits on its own.
// Browser.close is the app-quit path and is not used here.
async function closeLastWindow(profile) {
  const address = profile.cdp?.debuggerAddress || '';
  if (!String(address).startsWith('127.0.0.1:')) throw new Error(`last-window close CDP is not loopback-only (${address || 'missing'})`);
  await closeLastPage(profile.cdp.wsEndpoint);
}
async function waitExitType(id) {
  const file = path.join(dataDir, 'profiles', id, 'Default', 'Preferences');
  let value = null;
  for (let i = 0; i < 30; i++) {
    try { value = JSON.parse(fs.readFileSync(file, 'utf8'))?.profile?.exit_type || null; } catch {}
    if (value === 'Normal') return value;
    await sleep(100);
  }
  return value;
}
// Windows: taskkill /F is TerminateProcess. Elsewhere SIGKILL is the same kind of kill.
// A forced kill must stay Error, including when Chromium never rewrites exit_type.
function forceKill(pid) {
  if (process.platform !== 'win32') {
    process.kill(pid, 'SIGKILL');
    return Promise.resolve('SIGKILL');
  }
  return new Promise((resolve, reject) => {
    execFile('taskkill', ['/F', '/PID', String(pid)], err => err ? reject(err) : resolve('taskkill /F'));
  });
}
const readState = (pg, ctx) => Promise.all([
  pg.evaluate(() => localStorage.getItem('who')),
  ctx.cookies(ORIGIN).then(c => c.find(x => x.name === 'who')?.value ?? null),
]);
const writeState = (pg, v) => pg.evaluate(v => {
  localStorage.setItem('who', v);
  document.cookie = `who=${v}; max-age=86400; path=/`;
}, v);

try {
  srv = await spawnServer(env, { envName: 'PM_TEST_PORT', echo: true });
  B = srv.url;
  startEvents();
  await sleep(200);

  // Tab close keeps the browser. Closing the last window is Stopped, not Error.
  const plain = await launch('Plain');
  const br = await connect(plain);
  const ctx = br.contexts()[0];
  const extra = await ctx.newPage();
  await extra.goto(ORIGIN);
  await extra.close();
  await sleep(400);
  let row = (await api('GET', `/api/profiles/${plain.id}`)).d;
  ok(row.running && alive(plain.cdp.pid) && ctx.pages().length >= 1, 'closing one tab leaves the profile running');
  const keepPage = ctx.pages()[0] || await ctx.newPage();
  await keepPage.goto(ORIGIN);
  await writeState(keepPage, 'window');
  await br.close().catch(() => {});
  await closeLastWindow(plain);
  row = await settled(plain.id);
  await sleep(900);
  stoppedClean(row, plain.cdp.pid, 'last-window close');
  const plainExit = await waitExitType(plain.id);
  ok(plainExit === 'Normal', `last-window close wrote exit_type Normal (${plainExit})`);
  onceEach(plain.id, 'last-window close', { stopped: 1, crashed: 0 });
  const plainAgain = (await api('POST', `/api/profiles/${plain.id}/launch`)).d;
  ok(plainAgain.running && !plainAgain.last_error, 'relaunch after last window is running with no last_error');
  const brPlain = await connect(plainAgain);
  const pgPlain = await brPlain.contexts()[0].newPage();
  await pgPlain.goto(ORIGIN);
  const windowState = await readState(pgPlain, brPlain.contexts()[0]);
  ok(windowState[0] === 'window' && windowState[1] === 'window', 'cookie and localStorage survived last window close');
  await pgPlain.close();
  await brPlain.close().catch(() => {});
  await api('POST', `/api/profiles/${plain.id}/stop`);
  await settled(plain.id);

  // Authenticated SOCKS5 uses the local relay. Closing that window is still Stopped.
  const socksProfile = await launch('Socks', { proxy: { type: 'socks5', host: '127.0.0.1', port: SOCKS, username: 'alice', password: 's3cret' } });
  ok(socksProfile.running, 'authenticated SOCKS5 profile launched');
  await closeLastWindow(socksProfile);
  row = await settled(socksProfile.id);
  stoppedClean(row, socksProfile.cdp.pid, 'SOCKS5 last window closed');

  // App Stop is Stopped, and the cookie survives a later launch.
  const keep = await launch('Keep');
  const brKeep = await connect(keep);
  const page = await brKeep.contexts()[0].newPage();
  await page.goto(ORIGIN);
  await writeState(page, 'kept');
  await page.close();
  await brKeep.close().catch(() => {});
  ok((await api('POST', `/api/profiles/${keep.id}/stop`)).s === 200, 'app Stop returns 200');
  row = await settled(keep.id);
  await sleep(900);
  stoppedClean(row, keep.cdp.pid, 'app Stop');
  onceEach(keep.id, 'app Stop', { stopped: 1, crashed: 0 });
  const again = (await api('POST', `/api/profiles/${keep.id}/launch`)).d;
  ok(again.running && !again.last_error, 'relaunch after Stop is running with no last_error');
  const brAgain = await connect(again);
  const pg = await brAgain.contexts()[0].newPage();
  await pg.goto(ORIGIN);
  const state = await readState(pg, brAgain.contexts()[0]);
  ok(state[0] === 'kept' && state[1] === 'kept', 'cookie and localStorage survived app Stop');
  await pg.close();
  await brAgain.close().catch(() => {});
  await api('POST', `/api/profiles/${keep.id}/stop`);
  row = await settled(keep.id);
  stoppedClean(row, again.cdp.pid, 'second Stop');
  for (let n = 1; n <= 2; n++) {
    const cycle = (await api('POST', `/api/profiles/${keep.id}/launch`)).d;
    ok(cycle.running && !cycle.last_error, `repeat launch ${n} is running with no last_error`);
    ok((await api('POST', `/api/profiles/${keep.id}/stop`)).s === 200, `repeat stop ${n} returns 200`);
    const done = await settled(keep.id);
    ok(!!done && !done.running && !done.last_error && !alive(cycle.cdp.pid) && !fs.existsSync(lockPath(keep.id)) && runningRows(keep.id) === 0, `repeat ${n} released the process, the lock, and the running row`);
  }
  const brKept = await connect((await api('POST', `/api/profiles/${keep.id}/launch`)).d);
  const pgKept = await brKept.contexts()[0].newPage();
  await pgKept.goto(ORIGIN);
  const keptState = await readState(pgKept, brKept.contexts()[0]);
  ok(keptState[0] === 'kept' && keptState[1] === 'kept', 'cookie and localStorage survived repeated launch and stop');
  await pgKept.close();
  await brKept.close().catch(() => {});
  await api('POST', `/api/profiles/${keep.id}/stop`);
  await settled(keep.id);

  // A real kill is Error. On Windows that kill is `taskkill /F`. Relaunch clears last_error.
  const crash = await launch('Crash');
  const killedWith = await forceKill(crash.cdp.pid);
  row = null;
  for (let i = 0; i < 40 && !(row && !row.running && row.last_error); i++) {
    row = (await api('GET', `/api/profiles/${crash.id}`)).d;
    await sleep(100);
  }
  await sleep(900);
  ok(!!row && !row.running && /unexpectedly|died/.test(row.last_error || ''), `${killedWith} marks Error (${row && row.last_error})`);
  onceEach(crash.id, killedWith, { stopped: 1, crashed: 1 });
  ok(!alive(crash.cdp.pid) && !fs.existsSync(lockPath(crash.id)), 'kill releases the process and the lockfile');
  ok(runningRows(crash.id) === 0, 'kill leaves no running row');
  const revived = (await api('POST', `/api/profiles/${crash.id}/launch`)).d;
  ok(revived.running && !revived.last_error, 'successful relaunch clears last_error');
  await api('POST', `/api/profiles/${crash.id}/stop`);
  await settled(crash.id);

  // SessionEnded is an OS logoff. CI cannot log off, so the test writes the pref
  // Chromium would have written, once the pid is already dead.
  const ended = await launch('Logoff');
  const prefsFile = path.join(dataDir, 'profiles', ended.id, 'Default', 'Preferences');
  const wrote = (async () => {
    for (let i = 0; i < 200 && alive(ended.cdp.pid); i++) await sleep(25);
    fs.mkdirSync(path.dirname(prefsFile), { recursive: true });
    let body = {};
    try { body = JSON.parse(fs.readFileSync(prefsFile, 'utf8')); } catch {}
    if (!body || typeof body !== 'object') body = {};
    body.profile = { ...(body.profile && typeof body.profile === 'object' ? body.profile : {}), exit_type: 'SessionEnded' };
    for (let i = 0; i < 40; i++) {
      try { fs.writeFileSync(prefsFile, JSON.stringify(body)); return; }
      catch { await sleep(25); }
    }
    throw new Error('could not write SessionEnded');
  })();
  await forceKill(ended.cdp.pid);
  await wrote;
  row = await settled(ended.id);
  await sleep(900);
  stoppedClean(row, ended.cdp.pid, 'SessionEnded');
  onceEach(ended.id, 'SessionEnded', { stopped: 1, crashed: 0 });

  // Close, Stop, and the health monitor together clean up once. A launch issued
  // while that cleanup is in flight must not start a second browser.
  const race = await launch('Race');
  const brRace = await connect(race);
  const pgRace = await brRace.contexts()[0].newPage();
  await pgRace.goto(ORIGIN);
  await writeState(pgRace, 'race');
  await pgRace.close();
  const session = await brRace.newBrowserCDPSession();
  const oldPid = race.cdp.pid;
  let overlap = false;
  // Stop and Browser.close are in flight together. Browser.close is an app-initiated
  // quit, not a last-window close. Either one may win; the loser throws.
  // launch() refuses a second browser while that close is still settling. A launch that
  // returns after settling has cleared is a new browser, and the old pid is already dead.
  const closing = session.send('Browser.close').catch(() => {});
  const stopping = api('POST', `/api/profiles/${race.id}/stop`);
  const probing = (async () => {
    for (let i = 0; i < 40; i++) {
      if (!alive(oldPid)) return;
      const cur = (await api('GET', `/api/profiles/${race.id}`)).d;
      if (!cur?.running || !alive(oldPid)) return;
      const again = await api('POST', `/api/profiles/${race.id}/launch`);
      const pid = again.d?.cdp?.pid;
      if (again.d?.running && pid && pid !== oldPid && alive(oldPid)) overlap = true;
      if (!alive(oldPid)) return;
      await sleep(50);
    }
  })();
  await Promise.all([closing, stopping, probing]);
  await brRace.close().catch(() => {});
  ok(!overlap, 'relaunch during close does not start a second browser');
  ok(!alive(oldPid), 'old browser is gone when the race settles');
  row = (await api('GET', `/api/profiles/${race.id}`)).d;
  const probePid = row?.running && row.cdp?.pid && row.cdp.pid !== oldPid ? row.cdp.pid : null;
  if (probePid) {
    const start = Date.now();
    let during;
    do {
      during = eventCounts(race.id);
      if (during.stopped >= 1) break;
      await sleep(50);
    } while (Date.now() - start < 2000);
    ok(during.stopped === 1, `old close emitted profile:stopped once before the new launch was judged (${during.stopped})`);
    ok(during.crashed === 0, `old close emitted no profile:crashed (${during.crashed})`);
    ok(row.running && !row.last_error, 'probe launch is running with no last_error');
    ok(lockBrowserPid(race.id) === probePid && probePid !== oldPid, `lock browser pid is the probe (${lockBrowserPid(race.id)}), not ${oldPid}`);
    ok(runningPid(race.id) === probePid, `running row pid is the probe (${runningPid(race.id)}), not ${oldPid}`);
    await api('POST', `/api/profiles/${race.id}/stop`);
    row = await settled(race.id);
    stoppedClean(row, probePid, 'probe stopped after the race');
    ok(!alive(oldPid), 'old pid is still gone after the probe stops');
  } else {
    row = await settled(race.id);
    await sleep(900);
    stoppedClean(row, oldPid, 'close and Stop together');
    onceEach(race.id, 'close and Stop together', { stopped: 1, crashed: 0 });
  }
  const raceAgain = (await api('POST', `/api/profiles/${race.id}/launch`)).d;
  ok(raceAgain.running && raceAgain.cdp.pid !== race.cdp.pid, 'launch after cleanup starts one new browser');
  const brRaceAgain = await connect(raceAgain);
  const pgRaceAgain = await brRaceAgain.contexts()[0].newPage();
  await pgRaceAgain.goto(ORIGIN);
  const raceState = await readState(pgRaceAgain, brRaceAgain.contexts()[0]);
  ok(raceState[0] === 'race' && raceState[1] === 'race', 'cookie and localStorage survived the close/Stop race');
  await pgRaceAgain.close();
  await brRaceAgain.close().catch(() => {});
  await api('POST', `/api/profiles/${race.id}/stop`);
  await settled(race.id);

  // IPC shutdown still persists storage and leaves no running row.
  const persist = await launch('Persist');
  const brP = await connect(persist);
  const pgP = await brP.contexts()[0].newPage();
  await pgP.goto(ORIGIN);
  await writeState(pgP, 'ipc');
  await pgP.close();
  await brP.close().catch(() => {});
  await stopServer(srv);
  srv = null;
  ok(!alive(persist.cdp.pid), 'IPC shutdown stops the browser');
  ok(runningRows(persist.id) === 0 && !fs.existsSync(lockPath(persist.id)), 'IPC shutdown leaves no running row and no lock');
  srv = await spawnServer(env, { envName: 'PM_TEST_PORT', echo: true });
  B = srv.url;
  const back = (await api('POST', `/api/profiles/${persist.id}/launch`)).d;
  ok(back.running && !back.last_error, 'profile launches after IPC shutdown');
  const brB = await connect(back);
  const pgB = await brB.contexts()[0].newPage();
  await pgB.goto(ORIGIN);
  const ipcState = await readState(pgB, brB.contexts()[0]);
  ok(ipcState[0] === 'ipc' && ipcState[1] === 'ipc', 'cookie and localStorage survived IPC shutdown');
  await pgB.close();
  await brB.close().catch(() => {});
  await api('POST', `/api/profiles/${persist.id}/stop`);
} catch (e) {
  fail++;
  console.error(e);
} finally {
  eventsAbort?.abort();
  if (srv) await stopServer(srv);
  killTracked();
  target.close();
  socks.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { console.error(e); }
  fail += missedGracefulShutdowns();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
