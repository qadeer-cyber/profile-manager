// Window-close versus crash. A user closing the last window is Stopped.
// A killed browser is Error. One tab closing does not stop the profile.
import http from 'http';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
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

async function launch(name, extra) {
  const created = await api('POST', '/api/profiles', { name, ...extra });
  if (created.s !== 201) throw new Error('create failed ' + created.s + ' ' + JSON.stringify(created.d));
  const started = await api('POST', `/api/profiles/${created.d.id}/launch`);
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
  ok(!fs.existsSync(lockPath(p.id)), `${label}: lockfile released`);
}
async function connect(profile) {
  return chromium.connectOverCDP(profile.cdp.wsEndpoint);
}
// Headless Chromium stays up after the last page closes because Playwright owns the
// context. The window Close button is a graceful browser quit (exit code 0), which
// CDP Browser.close reproduces without going through the app's Stop route.
async function closeLastWindow(profile) {
  const br = await connect(profile);
  try {
    const session = await br.newBrowserCDPSession();
    await session.send('Browser.close');
  } catch { /* the pipe drops as the browser exits */ }
  finally { await br.close().catch(() => {}); }
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
  await br.close().catch(() => {});
  await closeLastWindow(plain);
  row = await settled(plain.id);
  stoppedClean(row, plain.cdp.pid, 'last window closed');

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
  stoppedClean(row, keep.cdp.pid, 'app Stop');
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

  // Kill is Error. Relaunch clears last_error and the profile runs again.
  const crash = await launch('Crash');
  const evs = [];
  const ac = new AbortController();
  fetch(B + '/api/events', { signal: ac.signal }).then(async res => {
    const rd = res.body.getReader(), dec = new TextDecoder();
    for (;;) {
      const { value, done } = await rd.read();
      if (done) break;
      for (const m of dec.decode(value).matchAll(/data: (.*)/g)) evs.push(JSON.parse(m[1]));
    }
  }).catch(() => {});
  await sleep(200);
  process.kill(crash.cdp.pid, 'SIGKILL');
  row = null;
  for (let i = 0; i < 40 && !(row && !row.running && row.last_error); i++) {
    row = (await api('GET', `/api/profiles/${crash.id}`)).d;
    await sleep(100);
  }
  ok(!!row && !row.running && /unexpectedly|died/.test(row.last_error || ''), `kill marks Error (${row && row.last_error})`);
  ok(evs.some(e => e.type === 'profile:crashed' && e.id === crash.id), 'kill emits profile:crashed');
  ok(!alive(crash.cdp.pid) && !fs.existsSync(lockPath(crash.id)), 'kill releases the process and the lockfile');
  const revived = (await api('POST', `/api/profiles/${crash.id}/launch`)).d;
  ok(revived.running && !revived.last_error, 'successful relaunch clears last_error');
  await api('POST', `/api/profiles/${crash.id}/stop`);
  ac.abort();

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
  if (srv) await stopServer(srv);
  killTracked();
  target.close();
  socks.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { console.error(e); }
  fail += missedGracefulShutdowns();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
