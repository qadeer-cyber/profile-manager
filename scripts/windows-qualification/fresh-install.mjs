// Installed Windows qualification. The driver uses Node; AZWAH runs its packaged Electron runtime.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, _electron } from 'playwright';
import { Server as ProxyServer } from 'proxy-chain';

assert.ok(process.platform === 'win32' && process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_TEMP);
const root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'azwah-fresh-'));
const install = path.join(root, 'installed'), data = path.join(root, 'userdata');
const exe = path.join(install, 'AZWAH.exe');
const installer = path.resolve('release-ultimate-stable/Azwah-Setup-x64.exe');
const report = { host: { os: os.version(), cpu: os.cpus()[0].model, logicalCores: os.cpus().length,
  ramGiB: +(os.totalmem() / 2 ** 30).toFixed(2) }, samples: [], timingsMs: [] };
let application, ui, cacheRequests = 0;
const fixture = http.createServer((req, res) => {
  if (req.url === '/cache-probe') {
    res.writeHead(200, { 'Cache-Control': 'public,max-age=3600' }).end(String(++cacheRequests));
  } else res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end('<title>AZWAH local QA</title>');
});
const password = randomUUID();
let authenticated = 0;
const proxy = new ProxyServer({ host: '127.0.0.1', port: 0, prepareRequestFunction(req) {
  const allowed = req.username === 'fixture' && req.password === password;
  if (!allowed) return { requestAuthentication: true };
  if (req.hostname === 'api64.ipify.org' && req.port === 443) { authenticated++; return {}; }
  if (req.hostname === 'azwah-fixture.test' && req.isHttp) return { customResponseFunction: () => ({
    statusCode: 200, body: '<title>Authenticated test route</title>', headers: { 'Content-Type': 'text/html' },
  }) };
  throw new Error('Outside fixture scope');
} });
function setup() {
  execFileSync(installer, ['/S', '/D=' + install], { timeout: 180000 });
  assert.ok(fs.existsSync(exe));
}
function uninstall() {
  const uninstaller = fs.readdirSync(install).find(name => /^Uninstall.*\.exe$/i.test(name));
  execFileSync(path.join(install, uninstaller), ['/S', '_?=' + install], { timeout: 120000 });
  assert.ok(!fs.existsSync(exe));
  assert.ok(fs.existsSync(path.join(data, 'data', 'profiles.db')));
}
async function timed(operation, fn) {
  const start = performance.now();
  const result = await fn();
  report.timingsMs.push([operation, Math.round(performance.now() - start)]);
  return result;
}
async function open() {
  application = await _electron.launch({ executablePath: exe, cwd: install, timeout: 90000,
    env: { ...process.env, PM_USER_DATA: data, PM_SMOKE: '0' } });
  ui = await application.firstWindow();
  await ui.locator('main[data-shot="profiles"]').waitFor({ timeout: 60000 });
  const info = await ui.evaluate(() => window.pm.appInfo());
  assert.equal(info.packaged, true);
  assert.equal(info.version, '2.0.0-beta.1');
  assert.equal(path.resolve(info.userData), data);
}
async function api(method, route, body, status = 200) {
  const result = await ui.evaluate(async ({ method, route, body }) => {
    const r = await fetch('/api' + route, { method, headers: { 'Content-Type': 'application/json', 'X-UI-Token': window.pm.uiToken },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { method, route, body });
  assert.equal(result.status, status, method + ' ' + route + ' ' + (result.body?.code || ''));
  return result.body;
}
const route = id => '/profiles/' + id;
async function launch(id, label, url = 'about:blank') {
  const state = await timed('launch ' + label, () => api('POST', route(id) + '/launch', { url }));
  assert.ok(Number.isSafeInteger(state.pid) && state.pid > 0);
  assert.ok(state.cdp?.httpEndpoint?.startsWith('http://127.0.0.1:'));
  const browser = await chromium.connectOverCDP(state.cdp.httpEndpoint);
  const context = browser.contexts()[0];
  const version = await context.newPage();
  await version.goto('chrome://version');
  const profileDir = await version.locator('#profile_path').innerText();
  assert.equal(path.dirname(profileDir).toLowerCase(), path.join(data, 'data', 'profiles', id).toLowerCase());
  assert.equal(path.basename(await version.locator('#executable_path').innerText()).toLowerCase(), 'chrome.exe');
  await version.close();
  return { browser, page: context.pages()[0] || await context.newPage(), pid: state.pid };
}
const stop = async (id, label) => timed('stop ' + label, () => api('POST', route(id) + '/stop'));
async function sample(stage, count) {
  // Wait for complete Windows CIM samples. Stale or missing browser RSS cannot count as zero.
  let resources;
  for (let i = 0; i < 16; i++) {
    resources = await api('GET', '/resources');
    if (resources.browsers.profiles.length === count && resources.browsers.profilesObserved === count) break;
    await delay(1000);
  }
  assert.equal(resources.browsers.profilesObserved, count);
  const electron = await application.evaluate(({ app }) => app.getAppMetrics().map(p => ({
    kib: p.memory.workingSetSize, cpu: p.cpu.percentCPUUsage,
  })));
  const ping = performance.now();
  await ui.evaluate(() => document.querySelector('main').getBoundingClientRect().height);
  report.samples.push({ stage, profiles: count, chromeWorkingSetMiB: count ? resources.browsers.totalBrowserMemoryMiB : 0,
    chromeProcesses: resources.browsers.profiles.reduce((n, p) => n + p.processCount, 0),
    electronWorkingSetMiB: Math.round(electron.reduce((n, p) => n + p.kib, 0) / 1024),
    electronCpuPercent: +electron.reduce((n, p) => n + p.cpu, 0).toFixed(2),
    freeGiB: resources.host.freeMemGiB, rendererRoundTripMs: Math.round(performance.now() - ping) });
}
async function observe(page, label, seed) {
  return page.evaluate(async ({ label, seed }) => {
    const oldCookie = document.cookie;
    const oldLocal = localStorage.getItem('qa');
    const oldSession = sessionStorage.getItem('qa');
    const databases = (await indexedDB.databases()).map(db => db.name);
    const keys = await caches.keys();
    if (seed) {
      if (oldCookie || oldLocal || oldSession || databases.length || keys.length) throw new Error('Peer state visible before seed');
      document.cookie = 'qa=' + label + '; Path=/; Max-Age=86400';
      localStorage.setItem('qa', label);
      sessionStorage.setItem('qa', label);
      await new Promise((resolve, reject) => {
        const req = indexedDB.open(label);
        req.onsuccess = () => { req.result.close(); resolve(); };
        req.onerror = () => reject(req.error);
      });
      await caches.open(label);
    } else if (oldCookie !== 'qa=' + label || oldLocal !== label || !databases.includes(label) || !keys.includes(label)) {
      throw new Error('Persistent storage marker missing');
    }
    const first = await fetch('/cache-probe', { cache: 'force-cache' }).then(r => r.text());
    const second = await fetch('/cache-probe', { cache: 'force-cache' }).then(r => r.text());
    if (first !== second || !/^\d+$/.test(first)) throw new Error('HTTP cache probe failed');
    return first;
  }, { label, seed });
}
async function verifyStopped(id, label, peer) {
  const marks = (await api('GET', route(id) + '/bookmarks/export')).bookmarks;
  assert.ok(marks.some(b => b.name === 'سنڌ ' + label));
  assert.ok(!marks.some(b => b.name === 'سنڌ ' + peer));
  const history = (await api('GET', route(id) + '/history/export')).entries;
  assert.ok(history.some(h => h.url === origin + '/' + label));
  assert.ok(!history.some(h => h.url === origin + '/' + peer));
}
let origin;
try {
  fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
  origin = 'http://127.0.0.1:' + fixture.address().port;
  await proxy.listen();
  setup();
  fs.mkdirSync(data);
  assert.deepEqual(fs.readdirSync(data), []);
  await timed('first desktop open', open);
  assert.deepEqual(await api('GET', '/profiles'), []);
  await sample('idle', 0);
  const create = name => api('POST', '/profiles', { name, automationEnabled: true, advancedSettings: { runtime: 'stable-chrome' } }, 201);
  const { id: a } = await create('Fresh A');
  const { id: b } = await api('POST', route(a) + '/clone', { name: 'Fresh B', mode: 'settings' }, 201);
  assert.notEqual(a, b);
  await api('PUT', route(b), { name: 'Edited B' });
  await api('DELETE', route(b), undefined, 204);
  assert.ok((await api('GET', '/trash')).some(p => p.id === b));
  assert.equal((await api('POST', '/trash/' + b + '/restore')).name, 'Edited B');
  for (const [id, label] of [[a, 'A'], [b, 'B']]) {
    const body = { content: JSON.stringify({ bookmarks: [{ name: 'سنڌ ' + label, url: origin + '/' + label, folder: 'Bookmarks bar / Private / QA' }] }) };
    assert.equal((await api('POST', route(id) + '/bookmarks/import', body)).imported, 1);
    assert.equal((await api('POST', route(id) + '/bookmarks/import', body)).duplicates, 1);
  }
  let first = await launch(a, 'A cold');
  await first.page.goto(origin + '/A');
  const firstCache = await observe(first.page, 'A', true);
  await sample('one', 1);
  const second = await launch(b, 'B cold');
  assert.notEqual(first.pid, second.pid);
  await second.page.goto(origin + '/B');
  assert.notEqual(await observe(second.page, 'B', true), firstCache);
  await sample('two', 2);
  const synced = await api('POST', '/sync/start', { leaderId: a, followerIds: [b] }, 201);
  await first.page.evaluate(() => document.body.innerHTML = '<input autofocus>');
  await second.page.evaluate(() => document.body.innerHTML = '<input autofocus>');
  await first.page.locator('input').focus();
  await second.page.locator('input').focus();
  await first.page.keyboard.type('qa');
  await second.page.waitForFunction(() => document.querySelector('input').value === 'qa');
  assert.equal((await api('POST', '/sync/' + synced.id + '/stop')).state, 'stopped');
  const job = await api('POST', '/cookie-robot/jobs', { profileId: a, urls: [origin + '/robot'] }, 202);
  let progress;
  for (let i = 0; i < 100; i++) {
    progress = await api('GET', '/cookie-robot/jobs/' + job.id);
    if (!['queued', 'running'].includes(progress.status)) break;
    await delay(250);
  }
  assert.equal(progress.status, 'done');
  assert.equal(progress.tasks[0].status, 'ok');
  assert.equal(first.page.url(), origin + '/A');
  const extra = [];
  for (const label of ['C', 'D']) {
    if (os.freemem() < 2 * 2 ** 30) break;
    const { id } = await create('Capacity ' + label);
    await launch(id, label);
    extra.push(id);
  }
  await sample('capacity', 2 + extra.length);
  if (extra.length === 2) {
    const fifth = await create('Above default cap');
    const refused = await api('POST', route(fifth.id) + '/launch', {}, 429);
    assert.equal(refused.code, 'TOO_MANY_PROFILES');
  }
  for (const id of extra) await stop(id, 'capacity');
  await stop(a, 'A');
  assert.equal(await second.page.evaluate(() => sessionStorage.getItem('qa')), 'B');
  first = await launch(a, 'A warm');
  await first.page.goto(origin + '/A');
  await observe(first.page, 'A', false);
  process.kill(first.pid, 'SIGKILL');
  for (let i = 0; i < 60 && (await api('GET', route(a))).running; i++) await delay(500);
  assert.equal((await api('GET', route(a))).running, false);
  await sample('after browser crash', 1);
  await stop(b, 'B');
  await verifyStopped(b, 'B', 'A');
  await launch(a, 'after browser crash');
  await timed('graceful desktop close with browser', () => application.close());
  application = null;
  await timed('desktop reopen', open);
  await verifyStopped(a, 'A', 'B');
  first = await launch(a, 'after desktop restart');
  await first.page.goto(origin + '/A');
  await observe(first.page, 'A', false);
  const child = application.process();
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  application = null;
  await timed('desktop crash recovery', open);
  assert.equal((await api('GET', route(a))).running, false);
  first = await launch(a, 'after forced desktop exit');
  await first.page.goto(origin + '/A');
  await observe(first.page, 'A', false);
  await stop(a, 'after recovery');
  await sample('settled', 0);
  const proxied = await api('POST', '/profiles', { name: 'Authenticated route', automationEnabled: true,
    advancedSettings: { runtime: 'stable-chrome' }, proxy: { type: 'http', host: '127.0.0.1', port: proxy.port, username: 'fixture', password } }, 201);
  const routed = await launch(proxied.id, 'authenticated HTTP');
  await routed.page.goto('http://azwah-fixture.test/');
  assert.equal(await routed.page.title(), 'Authenticated test route');
  assert.ok(authenticated > 0);
  await stop(proxied.id, 'authenticated HTTP');
  await application.close(); application = null;
  uninstall(); setup();
  await timed('same-version reinstall open', open);
  assert.equal((await api('GET', route(b))).name, 'Edited B');
  const restored = await launch(b, 'after reinstall');
  await restored.page.goto(origin + '/B');
  await observe(restored.page, 'B', false);
  await stop(b, 'after reinstall');
  await verifyStopped(b, 'B', 'A');
  await application.close(); application = null;
  uninstall();
  assert.ok(!fs.readFileSync(path.join(data, 'logs', 'main.log'), 'utf8').includes(password));
  console.log('FRESH_INSTALL_EVIDENCE ' + JSON.stringify(report));
} finally {
  if (application) await application.close().catch(() => {});
  fixture.closeAllConnections(); fixture.close();
  await proxy.close(true);
}
