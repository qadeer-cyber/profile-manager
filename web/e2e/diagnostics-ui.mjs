// M2 Diagnostics UI acceptance (evidence level 1: mocked API, real Chromium rendering).
// Builds web/ (unless DIAG_UI_SKIP_BUILD=1), serves web/dist from a local mock of the Profile Manager API
// that returns DiagnosticsV1 fixtures (DIAGNOSTICS_CONTRACT.md sections 1-6), and drives the page.
// Env: OUT_DIR (screenshots; default OS temp), DIAG_UI_DIST (dist dir), DIAG_UI_TIMEOUT_MS (watchdog),
//      DIAG_UI_BASELINE_SHOT=1 (only capture the Diagnostics page as served from DIAG_UI_DIST and exit).
import { chromium } from 'playwright-core';
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import crypto from 'node:crypto'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.resolve(process.env.DIAG_UI_DIST || path.join(ROOT, 'web', 'dist'));
const OUT = path.resolve(process.env.OUT_DIR || os.tmpdir()); fs.mkdirSync(OUT, { recursive: true });
const BASELINE = process.env.DIAG_UI_BASELINE_SHOT === '1';
const WD = setTimeout(() => { console.log('FAIL watchdog: diagnostics-ui exceeded time limit'); process.exit(1); }, Number(process.env.DIAG_UI_TIMEOUT_MS || 240000)); WD.unref();

if (!BASELINE && process.env.DIAG_UI_SKIP_BUILD !== '1') {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', 'web'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) { console.log('FAIL build: vite build web exited ' + r.status); process.exit(1); }
}
if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.log('FAIL no build at ' + DIST); process.exit(1); }

// ---------- DiagnosticsV1 fixtures ----------
const A = (value, source) => ({ availability: 'available', value, source });
const U = reason => ({ availability: 'unavailable', value: null, source: null, reason });
const iso = ms => new Date(ms).toISOString();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.85 Safari/537.36';
function diag(profileId, o = {}) {
  const now = Date.now(), launchId = 'launchId' in o ? o.launchId : 'launch-' + profileId + '-1';
  const d = {
    schemaVersion: 1, profileId,
    observation: { id: crypto.randomUUID(), launchId, requestedAt: iso(now - 140), completedAt: iso(now - 2), durationMs: 138, validUntil: iso(now + 20000), state: 'complete', reason: null },
    runtime: { chromiumVersion: A('131.0.6778.85', 'browser_protocol'), userAgent: A(UA, 'browser_protocol') },
    expected: { chromiumVersion: A('131.0.6778.85', 'manifest') },
    environment: { timezone: U('permission_required'), locale: U('permission_required'), languages: U('permission_required') },
    proxy: A({ configured: true, type: 'socks5', host: 'proxy.example.net', port: 1080 }, 'launch_snapshot'),
    webrtc: { commandLinePolicy: A({ state: 'present', value: 'disable_non_proxied_udp' }, 'browser_protocol'), effectivePolicy: U('unsupported'), iceCollection: 'not_collected' },
    consistency: { chromiumVersion: 'match' },
  };
  o.mut?.(d); return d;
}
const allUnavailable = (d, reason) => {
  d.runtime.chromiumVersion = U(reason); d.runtime.userAgent = U(reason); d.proxy = U(reason);
  d.environment = { timezone: U(reason), locale: U(reason), languages: U(reason) };
  d.webrtc.commandLinePolicy = U(reason); d.webrtc.effectivePolicy = U(reason); d.consistency.chromiumVersion = 'unknown';
};
const envResult = (profileId, launchId) => diag(profileId, { launchId, mut: d => {
  d.environment = { timezone: A('Europe/Berlin', 'visible_probe'), locale: A('de-DE', 'visible_probe'), languages: A(['de-DE', 'en-US'], 'visible_probe') };
} });
const errBody = code => ({ error: { code, message: 'SERVER-MESSAGE-' + code, requestId: crypto.randomUUID() } });

// ---------- mock API ----------
const INJECT = '<img src=x onerror="window.__pwned=1">';
const t0 = '2026-10-19T10:00:00.000Z';
const P = (id, name, folder, running, last_error = null, tags = []) => ({ id, name, folder, tags, notes: '', running, last_error, created_at: t0, updated_at: t0, last_launched_at: t0, proxyId: null, proxy: null, automationEnabled: false });
const S = {
  profiles: [P('p-alpha', 'Alpha Shop', 'Work', true, null, ['shop']), P('p-bravo', 'Bravo', 'Work', false), P('p-charlie', 'Charlie ' + INJECT, '', false, 'Browser exited unexpectedly (exit code 1)'), P('p-delta', 'Delta', 'Personal', true)],
  diag: {}, env: {}, log: [], sse: new Set(),
};
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
const reply = async (res, h, req) => {
  const r = typeof h === 'function' ? h(req) : h;
  if (!r) return json(res, 404, errBody('PROFILE_NOT_FOUND'));
  if (r.delay) await new Promise(x => setTimeout(x, r.delay));
  if (r.destroy) return res.socket.destroy(); // network failure
  json(res, r.status || 200, r.body);
};
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname; let body = '';
  for await (const c of req) body += c;
  const entry = { method: req.method, path: p, search: u.search, body, headers: req.headers, at: Date.now() };
  if (p.startsWith('/api/') && p !== '/api/events') S.log.push(entry);
  let m;
  if (p === '/api/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' }); res.write(':ok\n\n'); S.sse.add(res); req.on('close', () => S.sse.delete(res)); return; }
  if (p === '/api/profiles' && req.method === 'GET') return json(res, 200, S.profiles);
  if ((m = p.match(/^\/api\/profiles\/([^/]+)\/diagnostics$/)) && req.method === 'GET') return reply(res, S.diag[decodeURIComponent(m[1])], entry);
  if ((m = p.match(/^\/api\/profiles\/([^/]+)\/diagnostics\/environment$/)) && req.method === 'POST') return reply(res, S.env[decodeURIComponent(m[1])], entry);
  if ((m = p.match(/^\/api\/profiles\/([^/]+)$/)) && req.method === 'GET') { const x = S.profiles.find(q => q.id === decodeURIComponent(m[1])); return x ? json(res, 200, x) : json(res, 404, { error: 'not found' }); }
  if (p === '/api/meta') return json(res, 200, { tags: ['shop'], folders: ['', 'Personal', 'Work'], running: S.profiles.filter(x => x.running).map(x => x.id) });
  if (p === '/api/browser') return json(res, 200, { path: '/opt/pm/chromium/chrome', installed: false, custom: false, browsersPath: 'default', install: { state: 'idle', error: null, log: '' }, chromium: null });
  if (p === '/api/diagnostics') return json(res, 200, { app: { version: '0.5.0-alpha.1', mode: 'node' }, versions: { node: '22.12.0', electron: null, chrome: null }, platform: 'linux test x64', dataDir: '/tmp/pm-mock-data', schemaVersion: 6, migration: null, encryption: { backend: 'mock', warning: null }, browser: {}, profiles: S.profiles.length, proxies: 0, running: 2, pid: 1 });
  if (p === '/api/settings') return json(res, 200, { defaultHeadless: false, executablePath: '', startUrl: '' });
  if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });
  let f = path.join(DIST, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const B = `http://127.0.0.1:${server.address().port}`;
const push = e => { for (const r of S.sse) r.write(`data: ${JSON.stringify({ at: new Date().toISOString(), ...e })}\n\n`); };
const diagReqs = () => S.log.filter(x => /\/diagnostics(\/environment)?$/.test(x.path) && x.path.startsWith('/api/profiles/'));
const gets = () => diagReqs().filter(x => x.method === 'GET'), posts = () => diagReqs().filter(x => x.method === 'POST');

// ---------- browser ----------
const errs = []; let pass = 0, fail = 0, consents = 0;
const b = await chromium.launch();
const closeAll = async () => { try { await b.close(); } catch {} try { for (const r of S.sse) r.destroy(); server.close(); } catch {} };
process.on('uncaughtException', async e => { console.log('FAIL uncaught:', e.message); await closeAll(); process.exit(1); });
process.on('unhandledRejection', async e => { console.log('FAIL unhandled:', e?.message || e); await closeAll(); process.exit(1); });
const step = async (n, fn) => { try { await fn(); pass++; console.log('PASS', n); } catch (e) { fail++; console.log('FAIL', n, '-', String(e.message).split('\n')[0]); } };
const ok = (c, msg) => { if (!c) throw new Error(msg); };
// The app shell scrolls inside .content (100vh); expand it so full-page screenshots show every panel.
const shot = async (pg, name, { expand = true } = {}) => {
  if (!expand) return pg.screenshot({ path: path.join(OUT, name), animations: 'disabled' });
  const h = await pg.addStyleTag({ content: '.app{height:auto!important;min-height:100vh}.content{overflow:visible!important}' });
  await pg.screenshot({ path: path.join(OUT, name), fullPage: true, animations: 'disabled' });
  await h.evaluate(e => e.remove());
};

let ctx, pg;
const MOCK_UI_TOKEN = 'mock-ui-token-' + crypto.randomUUID();
// Desktop session emulation (electron/preload.cjs shape): uiToken + onEvent, one shared event stream.
// web: true leaves window.pm undefined, i.e. web mode.
async function open({ width = 1360, height = 900, theme = 'light', dsf = 1, web = false } = {}) {
  if (ctx) await ctx.close();
  ctx = await b.newContext({ viewport: { width, height }, deviceScaleFactor: dsf });
  await ctx.addInitScript(t => localStorage.setItem('pm.theme', t), theme);
  if (!web) await ctx.addInitScript(tok => {
    const subs = new Set(); let es = null;
    window.pm = { desktop: true, uiToken: tok, platform: 'linux', onEvent: cb => {
      subs.add(cb);
      if (!es) { es = new EventSource('/api/events'); es.onmessage = m => { const e = JSON.parse(m.data); subs.forEach(f => f(e)); }; }
      return () => subs.delete(cb);
    } };
  }, MOCK_UI_TOKEN);
  pg = await ctx.newPage(); pg.setDefaultTimeout(6000);
  pg.on('pageerror', e => errs.push('pageerror: ' + e.message));
  pg.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errs.push('console: ' + m.text()));
  await pg.goto(B); await pg.waitForSelector('.side');
  await pg.click('[data-nav=diagnostics]'); await pg.waitForSelector('h1:has-text("Diagnostics")');
  if (BASELINE) { await pg.waitForSelector('.panel h2:text-is("App")'); return pg; }
  await pg.waitForSelector('[data-testid=profile-diagnostics]');
  await pg.waitForFunction(() => document.querySelectorAll('.pd-picker optgroup option').length >= 4);
  return pg;
}
const PD = '[data-testid=profile-diagnostics]';
const select = id => pg.selectOption(`${PD} .pd-picker select`, id);
const refresh = () => pg.click(`${PD} button:has-text("Refresh observation")`);
const observeBtn = () => pg.locator(`${PD} button:has-text("Observe timezone and language")`);
const factText = id => pg.locator(`${PD} [data-fact="${id}"] dd`).innerText();
const noOverflow = async () => pg.evaluate(() => {
  const c = document.querySelector('.content'), d = document.documentElement;
  return { doc: d.scrollWidth - d.clientWidth, content: c.scrollWidth - c.clientWidth };
});
const columns = () => pg.$$eval(`${PD} .pd-card`, els => new Set(els.map(e => Math.round(e.getBoundingClientRect().left))).size);

if (BASELINE) {
  await open(); await shot(pg, 'before-baseline-light.png'); console.log('baseline screenshot written to ' + OUT);
  await closeAll(); clearTimeout(WD); process.exit(0);
}

await open();
await step('existing Diagnostics content is kept (App, Browser engine, Download Chromium, Recent events)', async () => {
  for (const t of ['App', 'Browser engine', 'Recent events']) await pg.waitForSelector(`.panel h2:text-is("${t}")`);
  await pg.waitForSelector('button:has-text("Download Chromium")'); await pg.waitForSelector('text="/tmp/pm-mock-data"');
});
await step('no profile is preselected (listbox shows the placeholder, not a profile)', async () => {
  ok(await pg.$eval(`${PD} .pd-picker select`, e => e.value === '' && e.selectedOptions[0]?.textContent === 'No profile selected'), 'preselected');
});
await step('no diagnostics request on page load or profile selection/search', async () => {
  await select('p-alpha'); await select('p-bravo'); await pg.fill(`${PD} input[type=search]`, 'del'); await pg.fill(`${PD} input[type=search]`, '');
  await select('p-alpha'); await pg.waitForTimeout(600);
  ok(gets().length === 0 && posts().length === 0, `diagnostics requests: ${JSON.stringify(diagReqs().map(x => x.method + ' ' + x.path))}`);
  await pg.waitForSelector(`${PD} [data-empty]`);
});
await step('selected profile identity: name, folder, availability as text', async () => {
  ok(await pg.locator(`${PD} [data-profile-name]`).innerText() === 'Alpha Shop', 'name');
  ok((await pg.locator(`${PD} .pd-identity`).innerText()).includes('Work'), 'folder');
  ok((await pg.locator(`${PD} [data-profile-status]`).innerText()).trim() === 'Running', 'status text');
  await select('p-charlie');
  ok((await pg.locator(`${PD} [data-profile-status]`).innerText()).trim() === 'Error', 'error status');
  ok((await pg.locator(`${PD} .pd-identity`).innerText()).includes('closed unexpectedly'), 'last error summary');
});
await step('profile name with HTML is rendered as text (identity + options)', async () => {
  ok((await pg.locator(`${PD} [data-profile-name]`).innerText()).includes('<img'), 'literal text');
  ok(await pg.locator(`${PD} img`).count() === 0 && !(await pg.evaluate(() => window.__pwned)), 'no element injected');
});
await step('search filters and groups by folder', async () => {
  await select('p-alpha'); await pg.fill(`${PD} input[type=search]`, 'delt');
  const opts = await pg.$$eval(`${PD} .pd-picker optgroup option`, o => o.map(x => x.textContent));
  ok(opts.length === 2 && opts.some(t => t.startsWith('Delta')), 'filtered: ' + opts); // selected profile stays visible
  await pg.fill(`${PD} input[type=search]`, '');
  const groups = await pg.$$eval(`${PD} .pd-picker optgroup`, g => g.map(x => x.label));
  ok(groups.join('|') === 'Personal|Work|No folder', 'groups ' + groups);
});
await step('Observe button disabled before any observation', async () => { ok(await observeBtn().isDisabled(), 'enabled without observation'); });

S.diag['p-alpha'] = () => ({ delay: 700, body: diag('p-alpha', { launchId: 'launch-A1' }) });
await step('loading state, then complete observation with every panel', async () => {
  await refresh();
  await pg.waitForSelector(`${PD} [data-loading]`);
  ok(await pg.locator(`${PD} button:has-text("Observing…")`).isDisabled(), 'refresh not disabled while loading');
  await pg.waitForSelector(`${PD} [data-observation=complete]`, { timeout: 4000 });
  ok((await factText('runtime.chromiumVersion')).includes('131.0.6778.85') && (await factText('runtime.chromiumVersion')).includes('Source: Browser protocol'), 'runtime chromium');
  ok((await factText('expected.chromiumVersion')).includes('Source: Chromium manifest'), 'manifest source');
  ok((await factText('consistency.chromiumVersion')).includes('Versions match'), 'match');
  const ua = await factText('runtime.userAgent'); ok(ua.includes('Chrome/131') && /pages can override/i.test(ua), 'ua + override note');
  ok((await pg.locator(`${PD} [data-fact="runtime.userAgent"] dt`).innerText()) === 'Browser-level user agent', 'UA label');
  ok((await factText('proxy')).includes('SOCKS5') && (await factText('proxy')).includes('proxy.example.net:1080') && (await factText('proxy')).includes('Source: Launch snapshot'), 'proxy');
  ok((await factText('webrtc.commandLinePolicy')).includes('Present') && (await factText('webrtc.commandLinePolicy')).includes('disable_non_proxied_udp'), 'webrtc present');
  ok((await factText('webrtc.effectivePolicy')).includes('can’t report this value'), 'effective unavailable reason');
  ok((await factText('webrtc.iceCollection')) === 'ICE candidates not collected in M2', 'ice');
  ok((await factText('environment.timezone')).includes('Needs your permission'), 'env permission_required');
  const card = await pg.locator(`${PD} [data-card=pd-webrtc]`).innerText();
  ok(/absent flag doesn’t prove/i.test(card) && !/anonym|leak|protected\b(?! )/i.test(card.replace('whether your IP address is protected', '')), 'webrtc disclaimer / no claims');
  const obs = await pg.locator(`${PD} [data-observation]`).innerText();
  ok(/Complete/.test(obs) && /138 ms/.test(obs) && /Fresh until/.test(obs) && /not live monitoring/.test(obs), 'observation: ' + obs);
  ok(await pg.locator(`${PD} [data-observation] time`).count() >= 3, 'timestamps');
  ok(gets().length === 1 && gets()[0].search === '', 'exactly one GET without query string');
  ok(!(await observeBtn().isDisabled()), 'observe enabled with launchId');
  await shot(pg, 'after-complete-light.png');
});
await step('duplicate refresh clicks send one request', async () => {
  const before = gets().length;
  await pg.evaluate(() => { const btn = [...document.querySelectorAll('[data-testid=profile-diagnostics] button')].find(x => x.textContent === 'Refresh observation'); for (let i = 0; i < 5; i++) btn.click(); });
  await pg.waitForSelector(`${PD} [data-observation=complete]`, { timeout: 4000 }); await pg.waitForTimeout(300);
  ok(gets().length - before === 1, 'requests sent: ' + (gets().length - before));
});
await step('response for a superseded profile selection is dropped', async () => {
  const before = gets().length;
  S.diag['p-alpha'] = () => ({ delay: 900, body: diag('p-alpha', { launchId: 'launch-A1' }) });
  await refresh(); await pg.waitForSelector(`${PD} [data-loading]`);
  await select('p-bravo'); await pg.waitForTimeout(1300);
  ok(gets().length - before === 1, 'gets');
  ok(await pg.locator(`${PD} [data-observation]`).count() === 0, 'alpha result rendered for bravo');
  await pg.waitForSelector(`${PD} [data-empty]`);
  await select('p-alpha'); await pg.waitForTimeout(200);
  ok(await pg.locator(`${PD} [data-observation]`).count() === 0, 'dropped result reappeared');
});
await step('response with another profileId is rejected', async () => {
  S.diag['p-alpha'] = { body: diag('p-delta') }; await refresh();
  await pg.waitForSelector(`${PD} [data-error-code=wrong_profile]`); ok(await pg.locator(`${PD} [data-observation]`).count() === 0, 'rendered');
});
for (const [name, mut] of [
  ['extra property', d => { d.extra = 1; }], ['schemaVersion 2', d => { d.schemaVersion = 2; }],
  ['unavailable fact with value', d => { d.runtime.userAgent = { availability: 'unavailable', value: 'x', source: null, reason: 'timeout' }; }],
  ['unknown reason', d => { d.runtime.userAgent = U('nope'); }], ['proxy port out of range', d => { d.proxy.value.port = 70000; }],
  ['user agent over 1024', d => { d.runtime.userAgent.value = 'x'.repeat(1025); }], ['non-UTC timestamp', d => { d.observation.completedAt = '2026-10-19T10:00:00+02:00'; }],
  ['negative durationMs', d => { d.observation.durationMs = -1; }], ['21 languages', d => { d.environment.languages = A(Array(21).fill('en'), 'visible_probe'); }],
  ['iceCollection changed', d => { d.webrtc.iceCollection = 'collected'; }],
]) await step('malformed response is an error, nothing rendered: ' + name, async () => {
  S.diag['p-alpha'] = { body: diag('p-alpha', { mut }) }; await refresh();
  await pg.waitForSelector(`${PD} [data-error-code=malformed]`); ok(await pg.locator(`${PD} [data-observation]`).count() === 0, 'rendered');
});
for (const [status, code, want] of [[400, 'INVALID_REQUEST', 'rejected as invalid'], [401, 'UNAUTHORIZED', 'isn’t authorized'], [404, 'PROFILE_NOT_FOUND', 'no longer exists'],
  [409, 'LAUNCH_CHANGED', 'The browser was relaunched; refresh the observation first'], [429, 'DIAGNOSTICS_BUSY', 'already running'], [500, 'INTERNAL_ERROR', 'unexpected error']])
  await step(`HTTP ${status} ${code} shows specific text, no raw message`, async () => {
    S.diag['p-alpha'] = { status, body: errBody(code) }; await refresh();
    const el = pg.locator(`${PD} [data-error-code=${code}]`); await el.waitFor();
    const t = await el.innerText(); ok(t.includes(want), t);
    const all = await pg.locator(PD).innerText(); ok(!all.includes('[object Object]') && !all.includes('SERVER-MESSAGE'), 'raw message rendered');
    if (status === 500) ok(/note the time/.test(t), 'support hint');
    ok(await pg.locator(`${PD} [data-live]`).innerText().then(x => x.includes('failed')), 'announced');
    if (status === 429) await shot(pg, 'after-error-429.png');
  });

await step('unavailable (not_running) for a stopped profile; observe disabled', async () => {
  S.diag['p-bravo'] = { body: diag('p-bravo', { launchId: null, mut: d => { Object.assign(d.observation, { state: 'unavailable', reason: 'not_running', validUntil: null }); allUnavailable(d, 'not_running'); d.expected.chromiumVersion = A('131.0.6778.85', 'manifest'); } }) };
  await select('p-bravo'); await refresh(); await pg.waitForSelector(`${PD} [data-observation=unavailable]`);
  ok((await pg.locator(`${PD} [data-state]`).innerText()).includes('isn’t running'), 'reason text');
  ok((await factText('runtime.userAgent')).includes('Unavailable'), 'fact unavailable');
  ok(await observeBtn().isDisabled(), 'observe enabled'); ok((await pg.locator('#pd-env-hint').innerText()).includes('Needs a running profile'), 'hint');
  await shot(pg, 'after-unavailable.png');
});
await step('partial observation with version mismatch indicator', async () => {
  S.diag['p-delta'] = { body: diag('p-delta', { mut: d => { Object.assign(d.observation, { state: 'partial', reason: null }); d.runtime.chromiumVersion = A('130.0.6723.58', 'browser_protocol'); d.runtime.userAgent = U('timeout'); d.consistency.chromiumVersion = 'mismatch'; d.proxy = A({ configured: false }, 'launch_snapshot'); d.webrtc.commandLinePolicy = A({ state: 'absent', value: null }, 'browser_protocol'); } }) };
  await select('p-delta'); await refresh(); await pg.waitForSelector(`${PD} [data-observation=partial]`);
  const c = await factText('consistency.chromiumVersion'); ok(c.includes('Version mismatch') && c.includes('differs from the expected'), c);
  ok(await pg.locator(`${PD} .pd-card-mismatch`).count() === 1, 'card indicator');
  ok((await factText('runtime.userAgent')).includes('time limit'), 'timeout reason');
  ok((await factText('proxy')).includes('Not configured'), 'proxy not configured');
  ok((await factText('webrtc.commandLinePolicy')).includes('Absent'), 'absent');
  await shot(pg, 'after-partial-mismatch.png');
});
await step('invalidated observation; observe disabled', async () => {
  S.diag['p-delta'] = { body: diag('p-delta', { mut: d => { Object.assign(d.observation, { state: 'invalidated', reason: 'launch_changed', validUntil: null }); allUnavailable(d, 'launch_changed'); } }) };
  await refresh(); await pg.waitForSelector(`${PD} [data-observation=invalidated]`);
  ok((await pg.locator(`${PD} [data-state]`).innerText()).includes('Invalidated'), 'state'); ok(await observeBtn().isDisabled(), 'enabled');
});
await step('stale observation (validUntil in the past)', async () => {
  S.diag['p-delta'] = { body: diag('p-delta', { mut: d => { const n = Date.now(); Object.assign(d.observation, { requestedAt: iso(n - 60000), completedAt: iso(n - 59800), validUntil: iso(n - 30000) }); } }) };
  await refresh(); await pg.waitForSelector(`${PD} [data-fresh=stale]`);
  ok((await pg.locator(`${PD} [data-fresh]`).innerText()).includes('Stale — refresh to re-observe'), 'stale text');
  await shot(pg, 'after-stale.png');
});
await step('fresh turns stale on its own without fetching; 30 s display ceiling', async () => {
  S.diag['p-delta'] = { body: diag('p-delta', { mut: d => { d.observation.validUntil = iso(Date.now() + 1500); } }) };
  await refresh(); await pg.waitForSelector(`${PD} [data-fresh=fresh]`); const n = gets().length;
  await pg.waitForSelector(`${PD} [data-fresh=stale]`, { timeout: 4000 }); ok(gets().length === n, 'fetched while going stale');
  S.diag['p-delta'] = { body: diag('p-delta', { mut: d => { d.observation.validUntil = iso(Date.now() + 600000); } }) };
  await refresh(); await pg.waitForSelector(`${PD} [data-fresh=fresh]`);
  const until = Date.parse(await pg.getAttribute(`${PD} [data-fresh] time`, 'datetime')), completed = Date.parse(await pg.getAttribute(`${PD} [data-observation] dl > div:nth-child(4) time`, 'datetime'));
  ok(until - completed <= 30000, 'ceiling exceeded: ' + (until - completed));
});

// ---------- environment (POST) ----------
const okEnv = () => { S.diag['p-alpha'] = { body: diag('p-alpha', { launchId: 'launch-A1' }) }; };
await step('disclosure: exact text, dialog semantics; Cancel and Escape send nothing', async () => {
  okEnv(); S.env['p-alpha'] = { body: envResult('p-alpha', 'launch-A1') };
  await select('p-alpha'); await refresh(); await pg.waitForSelector(`${PD} [data-observation=complete]`);
  const p0 = posts().length;
  await observeBtn().click();
  const dlg = pg.getByRole('dialog', { name: 'Observe timezone and language' }); await dlg.waitFor();
  ok(await dlg.getAttribute('aria-modal') === 'true', 'aria-modal');
  ok(await pg.locator('[data-disclosure]').innerText() === 'Opens a visible diagnostic tab in the selected browser profile to read its timezone and language settings. Your existing pages will not be inspected. The tab will remain open until you close it.', 'disclosure text');
  ok(await pg.evaluate(() => document.activeElement?.textContent) === 'Cancel', 'initial focus');
  await shot(pg, 'after-disclosure-dialog.png', { expand: false });
  await pg.click('[role=dialog] button:has-text("Cancel")'); await dlg.waitFor({ state: 'detached' });
  await pg.waitForFunction(() => document.activeElement?.textContent === 'Observe timezone and language');
  await observeBtn().click(); await dlg.waitFor(); await pg.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached' });
  await pg.waitForTimeout(300); ok(posts().length === p0, 'POST without consent');
});
await step('confirm sends exactly {expectedLaunchId, consent}; values shown; consent asked again', async () => {
  const p0 = posts().length;
  await observeBtn().click(); await pg.click('[role=dialog] button:has-text("Open diagnostic tab")'); consents++;
  await pg.waitForFunction(() => document.querySelector('[data-fact="environment.timezone"] dd')?.textContent.includes('Europe/Berlin'));
  ok(posts().length === p0 + 1, 'one POST');
  const body = JSON.parse(posts().at(-1).body);
  ok(JSON.stringify(body) === JSON.stringify({ expectedLaunchId: 'launch-A1', consent: 'open-visible-diagnostic-tab' }), 'body ' + JSON.stringify(body));
  ok(posts().at(-1).search === '', 'query string on POST');
  ok((await factText('environment.locale')).includes('de-DE') && (await factText('environment.languages')).includes('de-DE, en-US') && (await factText('environment.timezone')).includes('Source: Visible diagnostic tab'), 'env values');
  ok(await pg.locator(`${PD} [data-env-observed]`).count() === 1, 'observed note');
  ok((await factText('runtime.chromiumVersion')).includes('131.0.6778.85'), 'runtime kept');
  await observeBtn().click(); await pg.getByRole('dialog').waitFor(); await pg.keyboard.press('Escape');
  ok(posts().length === p0 + 1, 'second POST without consent');
});
await step('Refresh is disabled while the environment POST is in flight; the POST result is shown', async () => {
  S.env['p-alpha'] = { delay: 900, body: envResult('p-alpha', 'launch-A1') };
  const refreshBtn = pg.locator(`${PD} button:has-text("Refresh observation"), ${PD} .pd-actions button.primary`).first();
  await observeBtn().click(); await pg.click('[role=dialog] button:has-text("Open diagnostic tab")'); consents++;
  await pg.waitForTimeout(150);
  ok(await refreshBtn.isDisabled(), 'Refresh enabled during POST');
  const g = gets().length; await refreshBtn.click({ force: true }).catch(() => {}); await pg.waitForTimeout(100);
  ok(gets().length === g, 'GET sent during POST');
  await pg.waitForFunction(() => document.querySelector('[data-fact="environment.timezone"] dd')?.textContent.includes('Europe/Berlin'));
  ok(await refreshBtn.isEnabled(), 'Refresh still disabled after POST');
});
for (const [label, h, code] of [['429', { status: 429, body: errBody('DIAGNOSTICS_BUSY') }, 'DIAGNOSTICS_BUSY'], ['500', { status: 500, body: errBody('INTERNAL_ERROR') }, 'INTERNAL_ERROR'], ['network failure', { destroy: true }, 'network']])
  await step(`Refresh ${label} keeps the previous observation and POST result, notice shown alongside`, async () => {
    const before = await pg.locator(`${PD} [data-observation]`).getAttribute('data-observation');
    S.diag['p-alpha'] = h; await refresh();
    await pg.locator(`${PD} [data-error-code=${code}]`).waitFor();
    ok(await pg.locator(`${PD} [data-observation]`).count() === 1, 'observation cleared');
    ok(await pg.locator(`${PD} [data-observation]`).getAttribute('data-observation') === before, 'observation changed');
    ok((await factText('runtime.chromiumVersion')).includes('131.0.6778.85'), 'runtime facts cleared');
    ok((await factText('environment.timezone')).includes('Europe/Berlin'), 'POST result cleared');
    ok(await observeBtn().isEnabled(), 'observe disabled after transient error');
    ok(await pg.locator(`${PD} [data-live]`).innerText().then(x => x.includes('failed')), 'not announced');
    if (code === 'DIAGNOSTICS_BUSY') await shot(pg, 'after-429-keeps-data.png');
    okEnv();
  });
await step('401 on Refresh still clears the observation', async () => {
  S.diag['p-alpha'] = { status: 401, body: errBody('UNAUTHORIZED') }; await refresh();
  await pg.locator(`${PD} [data-error-code=UNAUTHORIZED]`).waitFor();
  ok(await pg.locator(`${PD} [data-observation]`).count() === 0, 'observation kept after 401');
  okEnv(); await refresh(); await pg.waitForSelector(`${PD} [data-observation=complete]`);
  S.env['p-alpha'] = { body: envResult('p-alpha', 'launch-A1') };
});
await step('environment result from a different launch is not shown', async () => {
  S.env['p-alpha'] = { body: envResult('p-alpha', 'launch-OTHER') };
  await observeBtn().click(); await pg.click('[role=dialog] button:has-text("Open diagnostic tab")'); consents++;
  await pg.waitForSelector(`${PD} [data-env-other]`);
  ok(!(await pg.locator(`${PD} [data-card=pd-environment]`).innerText()).includes('Europe/Berlin'), 'other-launch value shown');
});
await step('POST 409 LAUNCH_CHANGED: relaunch text, observation superseded, observe disabled', async () => {
  S.env['p-alpha'] = { status: 409, body: errBody('LAUNCH_CHANGED') };
  await observeBtn().click(); await pg.click('[role=dialog] button:has-text("Open diagnostic tab")'); consents++;
  const el = pg.locator(`${PD} [data-error-code=LAUNCH_CHANGED]`); await el.waitFor();
  ok((await el.innerText()).includes('The browser was relaunched; refresh the observation first'), 'text');
  await pg.waitForSelector(`${PD} [data-superseded]`); ok(await observeBtn().isDisabled(), 'enabled');
});
await step('lifecycle event for selected profile marks observation superseded, no auto-fetch', async () => {
  okEnv(); await refresh(); await pg.waitForSelector(`${PD} [data-observation=complete]`); await pg.waitForFunction(() => !document.querySelector('[data-superseded]'));
  const g = gets().length, q = posts().length;
  push({ type: 'profile:started', id: 'p-delta' }); await pg.waitForTimeout(400);
  ok(await pg.locator(`${PD} [data-superseded]`).count() === 0, 'other profile event applied');
  push({ type: 'profile:crashed', id: 'p-alpha', error: 'x' }); await pg.waitForSelector(`${PD} [data-superseded]`);
  ok((await pg.locator(`${PD} [data-superseded]`).innerText()).includes('closed unexpectedly'), 'text');
  ok(await pg.locator(`${PD} [data-fresh=stale]`).count() === 1, 'not stale'); ok(await observeBtn().isDisabled(), 'observe enabled');
  await pg.waitForTimeout(500); ok(gets().length === g && posts().length === q, 'auto-fetch after event');
});
await step('profile availability label follows profile events (list refresh only; one extra event stream)', async () => {
  ok(S.sse.size <= 2, 'event streams open: ' + S.sse.size); // App's + this panel's single subscription
  const g = gets().length; S.profiles[0].running = false;
  push({ type: 'profile:stopped', id: 'p-alpha', error: null });
  await pg.waitForSelector(`${PD} [data-profile-status=stopped]`);
  ok((await pg.$$eval(`${PD} .pd-picker option`, o => o.map(x => x.textContent))).includes('Alpha Shop — Stopped'), 'option label');
  ok(gets().length === g, 'diagnostics fetched on event'); S.profiles[0].running = true;
});

// ---------- keyboard / a11y ----------
await step('accessible names, live region, definition lists', async () => {
  for (const n of ['Refresh observation', 'Observe timezone and language']) ok(await pg.getByRole('button', { name: n, exact: true }).count() === 1, 'button ' + n);
  ok(await pg.getByRole('searchbox', { name: 'Find a profile' }).count() === 1, 'searchbox');
  ok(await pg.getByRole('listbox', { name: /^Profile/ }).count() === 1, 'listbox');
  ok(await pg.locator(`${PD} [role=status][aria-live=polite]`).count() === 1, 'live region');
  ok(await pg.locator(`${PD} .pd-card dl dt`).count() >= 10 && await pg.locator(`${PD} .pd-card dl dd`).count() >= 10, 'dl facts');
  ok(await pg.getByRole('region', { name: 'Browser runtime' }).count() === 1, 'card region');
});
await step('keyboard-only: select, refresh, disclosure focus trap, Escape returns focus, Enter confirms', async () => {
  await open(); okEnv(); S.env['p-alpha'] = { body: envResult('p-alpha', 'launch-A1') };
  const active = () => pg.evaluate(() => { const a = document.activeElement; return (a?.getAttribute('type') || '') + '|' + (a?.tagName || '') + '|' + (a?.textContent || '').slice(0, 40); });
  let found = false; for (let i = 0; i < 40 && !found; i++) { await pg.keyboard.press('Tab'); found = (await active()).startsWith('search|INPUT'); }
  ok(found, 'search not reachable by Tab');
  await pg.keyboard.type('alpha'); await pg.keyboard.press('Tab'); ok((await active()).includes('SELECT'), 'select ' + await active());
  await pg.keyboard.press('ArrowDown');
  await pg.waitForSelector(`${PD} [data-profile-name]:text-is("Alpha Shop")`);
  await pg.keyboard.press('Tab'); ok((await active()).endsWith('Refresh observation'), 'refresh focus ' + await active());
  const outline = await pg.evaluate(() => getComputedStyle(document.activeElement).outlineStyle); ok(outline !== 'none', 'focus not visible');
  await pg.keyboard.press('Enter'); await pg.waitForSelector(`${PD} [data-observation=complete]`);
  await pg.keyboard.press('Tab'); ok((await active()).endsWith('Observe timezone and language'), 'observe focus ' + await active());
  await pg.keyboard.press('Enter'); await pg.getByRole('dialog').waitFor(); ok((await active()).endsWith('Cancel'), 'dialog focus');
  await pg.keyboard.press('Tab'); ok((await active()).endsWith('Open diagnostic tab'), 'tab 1');
  await pg.keyboard.press('Tab'); ok((await active()).endsWith('Cancel'), 'trap wrap');
  await pg.keyboard.press('Shift+Tab'); ok((await active()).endsWith('Open diagnostic tab'), 'trap shift');
  await pg.keyboard.press('Escape'); await pg.getByRole('dialog').waitFor({ state: 'detached' });
  await pg.waitForFunction(() => document.activeElement?.textContent === 'Observe timezone and language');
  const q = posts().length; await pg.keyboard.press('Enter'); await pg.getByRole('dialog').waitFor();
  await pg.keyboard.press('Tab'); await pg.keyboard.press('Enter'); consents++;
  await pg.waitForFunction(() => document.querySelector('[data-fact="environment.timezone"] dd')?.textContent.includes('Europe/Berlin'));
  ok(posts().length === q + 1, 'POST by keyboard');
});
await step('1,024-char user agent with HTML wraps without overflow and renders as text', async () => {
  const ua = (INJECT + ' ' + 'Mozilla/5.0(X11;Linux)' + 'A'.repeat(1024)).slice(0, 1024);
  S.diag['p-alpha'] = { body: diag('p-alpha', { launchId: 'launch-A1', mut: d => { d.runtime.userAgent = A(ua, 'browser_protocol'); } }) };
  await refresh(); await pg.waitForFunction(() => document.querySelector('[data-fact="runtime.userAgent"] dd')?.textContent.includes('AAAA'));
  const m = await pg.$eval(`${PD} [data-fact="runtime.userAgent"] dd .pd-mono`, e => ({ sw: e.scrollWidth, cw: e.clientWidth, text: e.textContent, card: e.closest('.pd-card').scrollWidth - e.closest('.pd-card').clientWidth }));
  ok(m.text === ua, 'text mismatch'); ok(m.sw <= m.cw + 1 && m.card <= 1, `overflow ${JSON.stringify({ sw: m.sw, cw: m.cw, card: m.card })}`);
  ok(await pg.locator(`${PD} img`).count() === 0 && !(await pg.evaluate(() => window.__pwned)), 'injected');
  const o = await noOverflow(); ok(o.doc <= 0 && o.content <= 0, 'page overflow ' + JSON.stringify(o));
});
const responsive = async (label, file) => {
  okEnv(); await select('p-alpha'); await refresh(); await pg.waitForSelector(`${PD} [data-observation=complete]`);
  ok(await columns() === 1, label + ': not single column');
  const o = await noOverflow(); ok(o.doc <= 0 && o.content <= 0, label + ' overflow ' + JSON.stringify(o));
  await shot(pg, file);
};
await step('web mode (no desktop UI token): desktop-only message, both actions disabled, zero diagnostics requests', async () => {
  await open({ web: true }); const n = diagReqs().length;
  await select('p-alpha'); await pg.waitForTimeout(200);
  const note = pg.locator(`${PD} [data-desktop-only]`);
  ok(await note.innerText() === 'Profile diagnostics are available in the Profile Manager desktop app.', 'message');
  ok(await pg.locator(`${PD} .pd-actions button.primary`).isDisabled(), 'Refresh enabled');
  ok(await observeBtn().isDisabled(), 'Observe enabled');
  await pg.locator(`${PD} .pd-actions button.primary`).click({ force: true }).catch(() => {});
  await observeBtn().click({ force: true }).catch(() => {});
  await pg.waitForTimeout(400);
  ok(diagReqs().length === n, 'diagnostics requests sent: ' + (diagReqs().length - n));
  ok(await pg.getByRole('dialog').count() === 0, 'disclosure opened');
  ok((await pg.locator(`${PD} [data-live]`).innerText()).includes('desktop app'), 'announced');
  ok(await pg.locator(`${PD} [data-empty]`).count() === 0, 'refresh prompt shown in web mode');
  await shot(pg, 'after-web-mode.png');
});
await step('every diagnostics request carried the desktop X-UI-Token header', async () => {
  ok(diagReqs().length > 0 && diagReqs().every(x => x.headers['x-ui-token'] === MOCK_UI_TOKEN), 'missing X-UI-Token');
});
await step('narrow 700px window: single column, no horizontal overflow', async () => { await open({ width: 700, height: 900 }); await responsive('700px', 'after-narrow-700.png'); });
await step('200% zoom (1360x820 window => 680x410 CSS px at DPR 2): single column, no overflow', async () => { await open({ width: 680, height: 410, dsf: 2 }); await responsive('200%', 'after-zoom-200.png'); });
await step('wide window: two-column panel grid', async () => { await open(); okEnv(); await select('p-alpha'); await refresh(); await pg.waitForSelector(`${PD} [data-observation=complete]`); ok(await columns() === 2, 'columns ' + await columns()); });
await step('dark theme renders the panels', async () => {
  await open({ theme: 'dark' }); okEnv(); await select('p-alpha'); await refresh(); await pg.waitForSelector(`${PD} [data-observation=complete]`);
  ok(await pg.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'theme');
  await shot(pg, 'after-complete-dark.png');
});
await step('zero POSTs without an explicit consent confirmation (whole run)', async () => { ok(posts().length === consents, `posts ${posts().length} vs consents ${consents}`); });
await step('no page or console errors', async () => { ok(!errs.length, errs.join(' | ')); });

console.log(`\n${pass} passed, ${fail} failed`); console.log('screenshots: ' + OUT);
await closeAll(); clearTimeout(WD);
process.exit(fail ? 1 : 0);
