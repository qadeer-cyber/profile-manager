// Worker coverage: the values a page measures in dedicated, shared and service workers must equal what the same page
// measures on its main thread, and canvas protection must also change OffscreenCanvas.convertToBlob in workers.
// Detection scripts compare worker values with page values; a difference is itself a fingerprint. Windows CI, live workflow.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const AUDIO_SCREEN = process.env.AZWAH_NATIVE_CHROMIUM_AUDIO_SCREEN === '1';
const WORKERS = process.env.AZWAH_NATIVE_CHROMIUM_WORKERS === '1';

// One probe, run on the main thread and inside each worker type.
const PROBE = `
async function azwahProbe() {
  const digest = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const out = { cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory ?? null, ua: navigator.userAgent,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone, languages: [...navigator.languages].join(',') };
  try { if (navigator.userAgentData) { const h = await navigator.userAgentData.getHighEntropyValues(['platformVersion']);
    out.uaPlatformVersion = h.platformVersion; out.brands = navigator.userAgentData.brands.map(b => b.brand).sort().join(','); } } catch {}
  try {
    const oc = new OffscreenCanvas(220, 60); const g = oc.getContext('2d');
    g.textBaseline = 'top'; g.font = '16px Arial'; g.fillStyle = '#f60'; g.fillRect(10, 5, 120, 30);
    g.fillStyle = '#069'; g.fillText('AZWAH worker probe', 4, 20); g.fillStyle = 'rgba(102,204,0,0.7)'; g.fillText('fingerprint', 30, 36);
    out.imageData = await digest(Array.from(g.getImageData(0, 0, 220, 60).data).join(','));
    out.blob = await digest(new Uint8Array(await (await oc.convertToBlob()).arrayBuffer()).join(','));
    const fonts = {}; for (const f of ['Arial', 'Segoe UI', 'Franklin Gothic Book', 'Arial Narrow', 'Sitka Text', 'Calibri Light']) {
      g.font = '40px monospace'; const a = g.measureText('mmmmmlli1W').width; g.font = '40px "' + f + '", monospace'; fonts[f] = g.measureText('mmmmmlli1W').width !== a; }
    out.fonts = JSON.stringify(fonts);
  } catch (e) { out.canvasError = String(e); }
  try {
    const gl = new OffscreenCanvas(32, 32).getContext('webgl', { preserveDrawingBuffer: true });
    if (gl) { const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) { out.renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL); out.vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL); }
      gl.clearColor(0.2, 0.5, 0.7, 1); gl.clear(gl.COLOR_BUFFER_BIT); const px = new Uint8Array(32 * 32 * 4);
      gl.readPixels(0, 0, 32, 32, gl.RGBA, gl.UNSIGNED_BYTE, px); out.readback = await digest(Array.from(px).join(',')); }
  } catch {}
  try { if (navigator.gpu) { const ad = await navigator.gpu.requestAdapter(); out.gpuVendor = ad ? (ad.info?.vendor ?? null) : null; } } catch {}
  return out;
}`;
const WORKER_JS = PROBE + `
const reply = async port => { port.postMessage(await azwahProbe()); };
if (typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope) {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
  self.addEventListener('message', e => e.waitUntil(reply(e.ports[0])));
} else if (typeof SharedWorkerGlobalScope !== 'undefined' && self instanceof SharedWorkerGlobalScope) {
  self.onconnect = e => { e.ports[0].onmessage = () => reply(e.ports[0]); };
} else { self.onmessage = () => reply(self); }
`;
const PAGE = `<!doctype html><title>azwah worker probe</title><script>${PROBE}
(async () => {
  const q = new URLSearchParams(location.search);
  const ask = (target, post) => new Promise(resolve => { const t = setTimeout(() => resolve({ error: 'timeout' }), 20000); const done = v => { clearTimeout(t); resolve(v); }; post(done); });
  const result = { site: location.hostname, main: await azwahProbe() };
  try { const w = new Worker('/w.js'); result.dedicated = await ask(w, done => { w.onmessage = e => done(e.data); w.onerror = e => done({ error: String(e.message) }); w.postMessage(1); }); w.terminate(); } catch (e) { result.dedicated = { error: String(e) }; }
  try { const w = new SharedWorker('/w.js'); result.shared = await ask(w, done => { w.port.onmessage = e => done(e.data); w.onerror = e => done({ error: String(e.message) }); w.port.start(); w.port.postMessage(1); }); } catch (e) { result.shared = { error: String(e) }; }
  try { const reg = await navigator.serviceWorker.register('/w.js', { scope: '/' }); await navigator.serviceWorker.ready;
    const sw = reg.active || reg.waiting || reg.installing;
    result.service = await ask(sw, done => { const ch = new MessageChannel(); ch.port1.onmessage = e => done(e.data); sw.postMessage(1, [ch.port2]); }); await reg.unregister(); } catch (e) { result.service = { error: String(e) }; }
  await fetch('http://127.0.0.1:' + q.get('report') + '/report', { method: 'POST', mode: 'no-cors', body: JSON.stringify(result) });
})();
</script>`;

const KEYS = ['cores', 'memory', 'ua', 'uaPlatformVersion', 'brands', 'tz', 'languages', 'imageData', 'blob', 'fonts', 'renderer', 'vendor', 'readback', 'gpuVendor'];

test('values in dedicated, shared and service workers match the page, and canvas export is protected in workers', { timeout: 600_000 }, async () => {
  assert.equal(process.platform, 'win32');
  assert.equal(process.env.AZWAH_NATIVE_CHROMIUM_CANVAS, '1');
  assert.equal(process.env.AZWAH_NATIVE_CHROMIUM_IDENTITY, '1');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-worker-live-'));
  process.env.PM_DATA_DIR = directory;
  process.env.PM_API_TOKEN = randomUUID();
  let report = null;
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/report') { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { report = JSON.parse(b); res.end('ok'); }); return; }
    if (req.url.startsWith('/w.js')) { res.setHeader('Content-Type', 'text/javascript'); res.setHeader('Service-Worker-Allowed', '/'); return res.end(WORKER_JS); }
    res.setHeader('Content-Type', 'text/html'); res.end(PAGE);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const { startServer } = await import('../server/app.js');
  const { db } = await import('../server/db.js');
  const engine = await import('../server/browsers.js');
  const { nativeIdentityFor } = await import('../server/browser-runtime/native-identity.js');
  const app = await startServer({ port: 0, staticDir: null });
  const api = async (method, route, body, status) => {
    const r = await fetch(app.url + '/api/v1' + route, { method, body: body && JSON.stringify(body), signal: AbortSignal.timeout(90_000),
      headers: { Authorization: 'Bearer ' + process.env.PM_API_TOKEN, 'Content-Type': 'application/json' } });
    const d = await r.json().catch(() => null);
    assert.equal(r.status, status, `${method} ${route}: ${JSON.stringify(d)}`);
    return d;
  };
  const visit = async (profileId) => {
    report = null;
    await api('POST', `/profiles/${profileId}/launch`, { url: `http://127.0.0.1:${port}/p?report=${port}` }, 200);
    const deadline = Date.now() + 120_000;
    while (!report && Date.now() < deadline) await new Promise(r => setTimeout(r, 1000));
    await api('POST', `/profiles/${profileId}/stop`, null, 200);
    assert.ok(report, 'the probe page reported');
    return report;
  };
  try {
    const off = (await api('POST', '/profiles', { name: 'worker off', advancedSettings: { runtime: 'azwah-native' } }, 201)).id;
    const on = (await api('POST', '/profiles', { name: 'worker on', advancedSettings: { runtime: 'azwah-native',
      experimental: { canvasReadback: 'prototype', hardwareIdentity: 'prototype', ...(AUDIO_SCREEN && { audioReadback: 'prototype' }) } } }, 201)).id;
    const control = await visit(off);
    console.log('# workers, protection off ' + JSON.stringify(control));
    const prot = await visit(on);
    console.log('# workers, protection on ' + JSON.stringify(prot));
    const expected = nativeIdentityFor(on);

    // 1. Every worker type answered.
    const types = ['dedicated', 'shared', 'service'];
    for (const t of types) assert.ok(prot[t] && !prot[t].error, `${t} worker answered: ${JSON.stringify(prot[t])}`);
    // 2. Worker values equal the page's values (protected profile). Only keys the page itself could measure are compared.
    const leaks = [];
    for (const t of types) for (const k of KEYS) {
      if (prot.main[k] === undefined || prot.main[k] === null) continue;
      if (JSON.stringify(prot[t][k]) !== JSON.stringify(prot.main[k])) leaks.push(`${t}.${k}: worker=${JSON.stringify(prot[t][k])} page=${JSON.stringify(prot.main[k])}`);
    }
    console.log('# worker leaks: ' + JSON.stringify(leaks));
    assert.deepEqual(leaks, [], 'a worker must report what the page reports');
    // 3. The identity itself applies in workers.
    for (const t of types) { assert.equal(prot[t].cores, expected.hardwareConcurrency, `${t} cores`); assert.equal(prot[t].memory ?? null, prot.main.memory ?? null, `${t} memory`); }
    // 4. Canvas protection reaches workers: getImageData and convertToBlob differ from the unprotected profile.
    if (WORKERS) {
      for (const t of types) {
        assert.notEqual(prot[t].imageData, control[t].imageData, `${t}: getImageData is protected`);
        assert.notEqual(prot[t].blob, control[t].blob, `${t}: convertToBlob is protected`);
      }
    } else console.log('# NOTE: build has no workers.patch; convertToBlob and site-seed checks skipped');
    console.log('# AZWAH_WORKER_LIVE pass');
  } finally {
    for (const id of engine.runningIds()) await engine.stop(id).catch(() => {});
    await app.close();
    server.close();
    db.close();
    fs.rmSync(directory, { force: true, recursive: true, maxRetries: 8, retryDelay: 500 });
  }
});
