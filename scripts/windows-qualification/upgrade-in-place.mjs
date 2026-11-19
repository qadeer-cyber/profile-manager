// In-place upgrade qualification: real pinned older installer -> real new installer, the user's
// default data location (%APPDATA%\azwah-multi-browser-ultimate, no PM_USER_DATA override), and a
// populated data directory. Runs only on a disposable GitHub Windows runner. All credentials,
// cookies and pages are synthetic; the evidence printed is counts, ids and SHA-256 digests.
//
// Scenarios, in order:
//   1. Old version installed and populated (profiles, folders, tags, notes, authenticated proxy,
//      cookies, localStorage/IndexedDB, nested Unicode bookmarks); integrity manifest recorded.
//   2. Interrupted upgrade: the new installer is killed mid-install; user data must be unchanged.
//   3. Upgrade while the old app is open with a browser profile running.
//   4. Old and new app open at the same time: the new app must not take over a profile the old one
//      runs, and must not kill its browser.
//   5. New version on the same data: everything from step 1 is present and browser-visible.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, _electron } from 'playwright';
import { Server as ProxyServer } from 'proxy-chain';

assert.ok(process.platform === 'win32' && process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_TEMP && process.env.APPDATA,
  'runs only on a disposable GitHub Windows runner');
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const fileSha = file => sha256(fs.readFileSync(file));
const root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'azwah-upgrade-'));
const install = path.join(root, 'installed');
const oldExe = path.join(install, 'Azwah Multi Browser Ultimate.exe');
const newExe = path.join(install, 'AZWAH.exe');
const priorInstaller = path.resolve('prior-source/release-ultimate-stable/Azwah-Ultimate-Stable-Chrome-Setup-x64.exe');
const newInstaller = path.resolve('release-ultimate-stable/Azwah-Setup-x64.exe');
const expectHash = (exe, sums) => assert.equal(fileSha(exe), fs.readFileSync(sums, 'utf8').trim().split(/\s+/)[0], `checksum ${path.basename(exe)}`);
// The real default location both editions use (electron/main.js sets it explicitly for Ultimate).
const defaultData = path.join(process.env.APPDATA, 'azwah-multi-browser-ultimate');
const dbFile = path.join(defaultData, 'data', 'profiles.db');
const report = { installers: {}, scenarios: {} };

// ---------- synthetic fixtures ----------
const proxyPassword = crypto.randomUUID();
let proxyHits = 0;
const proxy = new ProxyServer({ host: '127.0.0.1', port: 0, prepareRequestFunction(req) {
  if (!(req.username === 'upgrade-fixture' && req.password === proxyPassword)) return { requestAuthentication: true };
  if (req.hostname === 'azwah-upgrade.test' && req.isHttp) { proxyHits++; return { customResponseFunction: () => ({
    statusCode: 200, body: '<title>Upgrade proxy route</title>', headers: { 'Content-Type': 'text/html' } }) }; }
  throw new Error('Outside fixture scope');
} });
const site = http.createServer((req, res) => res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end('<title>upgrade fixture</title>'));

// ---------- installed app driver ----------
let app = null, ui = null;
function appEnv() {
  const env = { ...process.env, PM_SMOKE: '0' };
  delete env.PM_USER_DATA; // the real default data location
  delete env.PM_DATA_DIR;
  return env;
}
async function open(exe) {
  const handle = await _electron.launch({ executablePath: exe, cwd: install, timeout: 90000, env: appEnv() });
  const page = await handle.firstWindow();
  await page.waitForFunction(() => window.pm?.uiToken, null, { timeout: 60000 });
  await page.waitForLoadState('domcontentloaded');
  const main = await handle.evaluate(() => ({ pid: process.pid, executable: process.execPath }));
  assert.equal(path.resolve(main.executable).toLowerCase(), exe.toLowerCase(), 'driving the installed executable');
  return { handle, page, pid: main.pid, info: await page.evaluate(() => window.pm.appInfo()) };
}
async function use(exe) { const o = await open(exe); app = o.handle; ui = o.page; return o; }
async function closeApp() { if (app) { await app.close().catch(() => {}); app = null; ui = null; } }
async function api(page, method, route, body, status = 200) {
  const r = await page.evaluate(async ({ method, route, body }) => {
    const res = await fetch('/api' + route, { method, headers: { 'Content-Type': 'application/json', 'X-UI-Token': window.pm.uiToken },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { method, route, body });
  assert.equal(r.status, status, `${method} ${route}: ${JSON.stringify(r.body)?.slice(0, 300)}`);
  return r.body;
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const runInstaller = (exe, extra = []) => spawn(exe, ['/S', `/D=${install}`, ...extra], { stdio: 'ignore' });
const waitExit = child => new Promise(resolve => child.on('exit', code => resolve(code)));
const processes = name => { try { return execFileSync('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).split(/\r?\n/).filter(l => l.startsWith('"')).length; } catch { return 0; } };

// ---------- integrity manifest (no raw secrets or cookie values) ----------
function listFiles(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, base, out); else out.push(path.relative(base, p));
  }
  return out;
}
function dataManifest() {
  // Only files the app owns at rest; Chrome's own transient files are excluded.
  const files = listFiles(path.join(defaultData, 'data')).filter(f => !/-(wal|shm)$|\.bak$|LOCK$|\.log$|Singleton|Cache|GPUCache|Crashpad|\.pm-lock$/i.test(f));
  return { files: files.length, digest: sha256(files.sort().map(f => f + ':' + fileSha(path.join(defaultData, 'data', f))).join('\n')) };
}
async function appManifest(page) {
  const profiles = (await api(page, 'GET', '/profiles')).filter(p => !p.deletedAt)
    .map(p => ({ id: p.id, name: p.name, folder: p.folder, tags: [...(p.tags || [])].sort(), notes: p.notes, proxy: p.proxy ? { host: p.proxy.host, port: p.proxy.port, username: p.proxy.username } : null }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { count: profiles.length, profiles };
}

const NESTED_BOOKMARKS = { roots: { bookmark_bar: { type: 'folder', name: 'Bookmarks bar', id: '1', children: [
  { type: 'url', name: 'Upgrade ✓ Ünïcødé', url: 'https://upgrade.example/a', id: '4' },
  { type: 'folder', name: 'Arbeit ✓', id: '5', children: [{ type: 'folder', name: '深い', id: '6', children: [{ type: 'url', name: 'Café', url: 'https://upgrade.example/cafe', id: '7' }] }] },
] }, other: { type: 'folder', name: 'Other bookmarks', id: '2', children: [] }, synced: { type: 'folder', name: 'Mobile bookmarks', id: '3', children: [] } }, version: 1 };
const EXPECTED_BOOKMARKS = ['Bookmarks bar|Upgrade ✓ Ünïcødé|https://upgrade.example/a', 'Bookmarks bar/Arbeit ✓/深い|Café|https://upgrade.example/cafe'];

async function browserState(page, label) {
  return page.evaluate(async label => {
    const dbs = (await indexedDB.databases()).map(d => d.name);
    return { cookie: document.cookie.includes('upgrade=' + label), local: localStorage.getItem('upgrade') === label, idb: dbs.includes('upgrade-' + label) };
  }, label);
}
async function seedBrowserState(page, label) {
  await page.evaluate(async label => {
    document.cookie = 'upgrade=' + label + '; Path=/; Max-Age=864000';
    localStorage.setItem('upgrade', label);
    await new Promise((resolve, reject) => { const r = indexedDB.open('upgrade-' + label); r.onsuccess = () => { r.result.close(); resolve(); }; r.onerror = () => reject(r.error); });
  }, label);
}
// Cookies as the app lists them, without raw values: a digest when readable, else the reason.
async function cookieView(page, id) {
  return (await api(page, 'GET', `/profiles/${id}/cookies`)).cookies
    .map(c => ({ domain: c.domain, name: c.name, path: c.path, secure: !!c.secure, httpOnly: !!c.httpOnly,
      value: typeof c.value === 'string' ? 'sha256:' + sha256(c.value) : 'unreadable:' + (c.valueReason || 'unknown') }))
    .sort((a, b) => `${a.domain}|${a.name}|${a.path}`.localeCompare(`${b.domain}|${b.name}|${b.path}`));
}
async function launchProfile(page, id) {
  const state = await api(page, 'POST', `/profiles/${id}/launch`, {});
  assert.ok(state.cdp?.httpEndpoint, 'automation endpoint');
  const browser = await chromium.connectOverCDP(state.cdp.httpEndpoint);
  const context = browser.contexts()[0];
  return { browser, context, pid: state.pid ?? state.cdp.pid, page: context.pages()[0] || await context.newPage() };
}

try {
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  await proxy.listen();
  const origin = `http://127.0.0.1:${site.address().port}`;
  expectHash(priorInstaller, path.join(path.dirname(priorInstaller), 'SHA256SUMS.txt'));
  expectHash(newInstaller, path.join(path.dirname(newInstaller), 'SHA256SUMS.txt'));
  report.installers = { prior: { name: path.basename(priorInstaller), sha256: fileSha(priorInstaller), bytes: fs.statSync(priorInstaller).size },
    next: { name: path.basename(newInstaller), sha256: fileSha(newInstaller), bytes: fs.statSync(newInstaller).size } };
  // Disposable runner: the default location must start empty so the evidence is ours alone.
  if (fs.existsSync(defaultData)) fs.renameSync(defaultData, defaultData + '.pre-existing-' + Date.now());

  // ---------- 1. old version, populated ----------
  assert.equal(await waitExit(runInstaller(priorInstaller)), 0, 'old install');
  assert.ok(fs.existsSync(oldExe), 'old executable installed');
  const old = await use(oldExe);
  assert.equal(path.resolve(old.info.userData).toLowerCase(), defaultData.toLowerCase(), 'old version uses the default data location');
  const mk = body => api(ui, 'POST', '/profiles', { automationEnabled: true, advancedSettings: { runtime: 'stable-chrome' }, ...body }, 201);
  const A = await mk({ name: 'Upgrade A Ünïcødé', folder: 'Clients/Ünïcode', tags: ['alpha', 'β-tag'], notes: 'keep me ✓' });
  const B = await mk({ name: 'Upgrade B', folder: 'Team', tags: ['beta'], notes: '' });
  const P = await mk({ name: 'Upgrade proxied', folder: 'Team', tags: [], proxy: { type: 'http', host: '127.0.0.1', port: proxy.port, username: 'upgrade-fixture', password: proxyPassword } });
  const future = Math.floor(Date.now() / 1000) + 864000;
  await api(ui, 'POST', `/profiles/${B.id}/cookies/import`, { cookies: [{ name: 'imported', value: 'b-value', domain: 'b.upgrade.test', path: '/', secure: true, httpOnly: true, sameSite: 'Lax', expires: future }] });
  const importedFound = view => view.find(c => c.name === 'imported') || null;
  report.importedCookie = { afterImport: importedFound(await cookieView(ui, B.id)) };
  for (const [profile, label] of [[A, 'A'], [B, 'B']]) {
    const s = await launchProfile(ui, profile.id);
    await s.page.goto(`${origin}/${label}`);
    await seedBrowserState(s.page, label);
    assert.deepEqual(await browserState(s.page, label), { cookie: true, local: true, idb: true });
    await s.browser.close().catch(() => {});
    await api(ui, 'POST', `/profiles/${profile.id}/stop`);
  }
  // Bookmarks as Chrome stores them on disk (the old version has no bookmark import).
  fs.writeFileSync(path.join(defaultData, 'data', 'profiles', A.id, 'Default', 'Bookmarks'), JSON.stringify(NESTED_BOOKMARKS));
  const before = await appManifest(ui);
  assert.equal(before.count, 3);
  const cookiesBefore = { A: await cookieView(ui, A.id), B: await cookieView(ui, B.id) };
  report.importedCookie.afterChromeRanProfile = importedFound(cookiesBefore.B);
  report.cookieCountsBefore = { A: cookiesBefore.A.length, B: cookiesBefore.B.length };
  const schemaBefore = (await api(ui, 'GET', '/meta')).schemaVersion ?? null;
  await closeApp();
  const filesBefore = dataManifest();
  report.scenarios.populated = { profiles: before.count, files: filesBefore.files, digest: filesBefore.digest, schemaBefore };

  // ---------- 2. interrupted upgrade ----------
  const interrupted = runInstaller(newInstaller);
  await delay(4000);
  execFileSync('taskkill', ['/PID', String(interrupted.pid), '/T', '/F'], { stdio: 'ignore' });
  await waitExit(interrupted);
  await delay(2000);
  const filesAfterInterrupt = dataManifest();
  assert.deepEqual(filesAfterInterrupt, filesBefore, 'an interrupted install did not change user data');
  report.scenarios.interrupted = { dataUnchanged: true, oldExePresent: fs.existsSync(oldExe), newExePresent: fs.existsSync(newExe) };
  // Repair to the known old state if the interruption removed the old app.
  if (!fs.existsSync(oldExe)) assert.equal(await waitExit(runInstaller(priorInstaller)), 0, 'old reinstall after interruption');
  assert.deepEqual(dataManifest(), filesBefore, 'reinstalling the old version kept user data');

  // ---------- 3. upgrade while the old app runs a browser profile ----------
  const running = await use(oldExe);
  const sessionA = await launchProfile(ui, A.id);
  const oldBrowserPid = (await api(ui, 'GET', `/profiles/${A.id}`)).pid ?? sessionA.pid;
  const upgradeCode = await waitExit(runInstaller(newInstaller));
  report.scenarios.upgradeWhileRunning = { installerExit: upgradeCode, oldAppAlive: alive(running.pid), oldBrowserAlive: oldBrowserPid ? alive(oldBrowserPid) : null,
    oldExePresent: fs.existsSync(oldExe), newExePresent: fs.existsSync(newExe) };
  assert.equal(upgradeCode, 0, 'upgrade installer completed (retry after the interrupted attempt)');
  assert.ok(fs.existsSync(newExe), 'new executable installed');

  // ---------- 4. both versions open at once ----------
  if (alive(running.pid)) {
    let second = null, refused = null;
    try { second = await open(newExe); } catch (error) { refused = String(error.message).split('\n')[0]; }
    if (second) {
      // Mutual exclusion is per profile: the new app must not take over or kill A's browser.
      const taken = await second.page.evaluate(async id => (await fetch('/api/profiles/' + id + '/launch', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-UI-Token': window.pm.uiToken }, body: '{}' })).status, A.id);
      report.scenarios.bothOpen = { newOpened: true, launchOfOldOwnedProfile: taken, oldBrowserAliveAfterNewStartup: oldBrowserPid ? alive(oldBrowserPid) : null };
      assert.notEqual(taken, 200, 'the new app must not launch a profile the old app is running');
      if (oldBrowserPid) assert.ok(alive(oldBrowserPid), 'the new app did not kill the old app\'s running browser');
      await second.handle.close().catch(() => {});
    } else report.scenarios.bothOpen = { newOpened: false, refused };
  } else report.scenarios.bothOpen = { skipped: 'the installer closed the old app before replacing it' };
  await sessionA.browser.close().catch(() => {});
  if (alive(running.pid)) { await api(ui, 'POST', `/profiles/${A.id}/stop`).catch(() => {}); await closeApp(); }
  app = null; ui = null;
  for (let i = 0; i < 30 && processes('Azwah Multi Browser Ultimate.exe'); i++) await delay(1000);

  // ---------- 5. new version on the same data ----------
  const next = await use(newExe);
  assert.equal(path.resolve(next.info.userData).toLowerCase(), defaultData.toLowerCase(), 'new version opened the existing data location');
  assert.notEqual(next.info.version, old.info.version, 'a different version is running');
  const after = await appManifest(ui);
  assert.deepEqual(after, before, 'profiles, names, folders, tags, notes and proxy assignments are unchanged');
  const ids = after.profiles.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate profiles');
  // Each profile's cookie store is exactly what the old version had just before the upgrade
  // (names, flags and value digests; values Chrome encrypted are compared as unreadable).
  assert.deepEqual({ A: await cookieView(ui, A.id), B: await cookieView(ui, B.id) }, cookiesBefore, 'cookie stores unchanged by the upgrade');
  assert.ok(cookiesBefore.A.some(c => c.name === 'upgrade') && cookiesBefore.B.some(c => c.name === 'upgrade'), 'browser-written cookies were present before the upgrade');
  assert.equal(cookiesBefore.A.some(c => c.domain.includes('b.upgrade.test')), false, 'B\'s cookies are not in A');
  // Bookmarks: the new version's export and Chrome itself see the nested Unicode tree.
  const exported = (await api(ui, 'GET', `/profiles/${A.id}/bookmarks/export`)).bookmarks.map(b => `${b.folder} | ${b.name} | ${b.url}`);
  assert.ok(exported.length === 2 && exported.some(l => l.includes('深い')), `bookmarks export ${JSON.stringify(exported)}`);
  // Browser-visible state in each profile, and isolation between them.
  for (const [profile, label, peer] of [[A, 'A', 'B'], [B, 'B', 'A']]) {
    const s = await launchProfile(ui, profile.id);
    await s.page.goto(`${origin}/${label}`);
    assert.deepEqual(await browserState(s.page, label), { cookie: true, local: true, idb: true }, `${label} browser state after upgrade`);
    assert.deepEqual(await browserState(s.page, peer), { cookie: false, local: false, idb: false }, `${peer} state not visible in ${label}`);
    if (label === 'A') {
      const bm = await s.context.newPage();
      await bm.goto('chrome://bookmarks/');
      const seen = await bm.evaluate(() => new Promise(resolve => chrome.bookmarks.getTree(tree => {
        const out = []; const walk = (n, trail) => { if (n.url) out.push(`${trail.join('/')}|${n.title}|${n.url}`); (n.children || []).forEach(c => walk(c, n.url || !n.parentId ? trail : [...trail, n.title])); };
        tree.forEach(n => walk(n, [])); resolve(out);
      })));
      assert.deepEqual(seen, EXPECTED_BOOKMARKS, 'Chrome reads the bookmarks after upgrade');
    }
    await s.browser.close().catch(() => {});
    await api(ui, 'POST', `/profiles/${profile.id}/stop`);
  }
  // The proxy password saved by the old version still decrypts and authenticates.
  const routed = await launchProfile(ui, P.id);
  await routed.page.goto('http://azwah-upgrade.test/');
  assert.equal(await routed.page.title(), 'Upgrade proxy route');
  assert.ok(proxyHits > 0, 'authenticated through the proxy with the migrated credential');
  await routed.browser.close().catch(() => {});
  await api(ui, 'POST', `/profiles/${P.id}/stop`);
  report.scenarios.afterUpgrade = { profiles: after.count, cookies: 'kept', bookmarks: 'kept (Chrome-visible)', browserState: 'kept per profile, isolated', proxyCredential: 'decrypts and authenticates',
    schemaAfter: (await api(ui, 'GET', '/meta')).schemaVersion ?? null };
  await closeApp();
  const log = path.join(defaultData, 'logs', 'main.log');
  if (fs.existsSync(log)) assert.equal(fs.readFileSync(log, 'utf8').includes(proxyPassword), false, 'no proxy password in the app log');
  console.log('UPGRADE_IN_PLACE_EVIDENCE ' + JSON.stringify(report));
} catch (error) {
  console.log('UPGRADE_IN_PLACE_PARTIAL ' + JSON.stringify(report));
  throw error;
} finally {
  await closeApp();
  site.closeAllConnections?.(); site.close();
  await proxy.close(true).catch(() => {});
}
