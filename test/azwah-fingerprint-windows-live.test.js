// Canvas gate D and hardware/graphics identity, observed in AZWAH Chromium itself (Windows CI, live workflow).
// AZWAH Chromium launches are manual (no automation connection), so a local test page measures the browser and posts
// the values back. Two different sites in one session: http://127.0.0.1 and http://localhost.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const AUDIO_SCREEN = process.env.AZWAH_NATIVE_CHROMIUM_AUDIO_SCREEN === '1';
const GPU_FONTS = process.env.AZWAH_NATIVE_CHROMIUM_GPU_FONTS === '1';
const RECTS_UA = process.env.AZWAH_NATIVE_CHROMIUM_RECTS_UA === '1';
const PAGE = `<!doctype html><title>azwah fingerprint probe</title><canvas id=c width=220 height=60></canvas><script>
(async () => {
  const c = document.getElementById('c'); const g = c.getContext('2d');
  g.textBaseline = 'top'; g.font = '16px Arial'; g.fillStyle = '#f60'; g.fillRect(10, 5, 120, 30);
  g.fillStyle = '#069'; g.fillText('AZWAH canvas probe \\u{1F600}', 4, 20); g.fillStyle = 'rgba(102,204,0,0.7)'; g.fillText('fingerprint', 30, 36);
  const digest = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const dataUrl = await digest(c.toDataURL());
  const pixels = await digest(Array.from(g.getImageData(0, 0, c.width, c.height).data).join(','));
  let renderer = null, vendor = null;
  try { const gl = document.createElement('canvas').getContext('webgl'); const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) { renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL); vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL); } } catch {}
  let audio = null;
  try { const ctx = new OfflineAudioContext(1, 5000, 44100); const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 10000;
    const comp = ctx.createDynamicsCompressor(); osc.connect(comp); comp.connect(ctx.destination); osc.start(0);
    const buf = await ctx.startRendering(); audio = await digest(Array.from(buf.getChannelData(0).slice(4500)).join(',')); } catch {}
  const fontProbe = f => document.fonts.check('12px "' + f + '"') && (() => { const x = document.createElement('canvas').getContext('2d');
    x.font = '40px monospace'; const a = x.measureText('mmmmmlli1W').width; x.font = '40px "' + f + '", monospace'; return x.measureText('mmmmmlli1W').width !== a; })();
  const fonts = { arial: fontProbe('Arial'), segoe: fontProbe('Segoe UI'), courier: fontProbe('Courier New'), notInList: fontProbe('Franklin Gothic Book') };
  // Candidate fonts that a Windows machine may have; the test keeps those this machine really has.
  const candidates = ['Arial Narrow', 'Book Antiqua', 'Bookman Old Style', 'Century', 'Century Gothic', 'Garamond', 'Gill Sans MT',
    'Lucida Bright', 'Monotype Corsiva', 'Rockwell', 'Tw Cen MT', 'Sitka Text', 'Calibri Light', 'Franklin Gothic Book', 'Haettenschweiler'];
  const fontList = Object.fromEntries(candidates.map(f => [f, fontProbe(f)]));
  const box = document.createElement('div'); box.style.cssText = 'position:absolute;left:13.3px;top:7.7px;width:101.1px;height:33.3px;font:15px Arial';
  box.textContent = 'AZWAH rect probe'; document.body.appendChild(box);
  const r = box.getBoundingClientRect(); const list = box.getClientRects()[0];
  const rects = [r.x, r.y, r.width, r.height, list.width].join(',');
  let webglPixels = null;
  try { const gc = document.createElement('canvas'); gc.width = 32; gc.height = 32; const gl = gc.getContext('webgl', { preserveDrawingBuffer: true });
    if (gl) { gl.clearColor(0.2, 0.5, 0.7, 1); gl.clear(gl.COLOR_BUFFER_BIT); const px = new Uint8Array(32 * 32 * 4);
      gl.readPixels(0, 0, 32, 32, gl.RGBA, gl.UNSIGNED_BYTE, px); webglPixels = await digest(Array.from(px).join(',')); } } catch {}
  let hints = null;
  try { if (navigator.userAgentData) { const h = await navigator.userAgentData.getHighEntropyValues(['platformVersion']);
    hints = { platformVersion: h.platformVersion, brands: navigator.userAgentData.brands.map(b => b.brand).sort() }; } } catch {}
  let gpuVendor = null; try { if (navigator.gpu) { const ad = await navigator.gpu.requestAdapter(); gpuVendor = ad ? (ad.info?.vendor ?? null) : null; } } catch {}
  const q = new URLSearchParams(location.search);
  await fetch('http://127.0.0.1:' + q.get('report') + '/report', { method: 'POST', mode: 'no-cors', body: JSON.stringify({
    site: location.hostname, step: q.get('step'), dataUrl, pixels, cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory ?? null, renderer, vendor, audio, screen: screen.width + 'x' + screen.height, fonts, fontList, gpuVendor, rects, webglPixels, hints }) });
  const next = q.get('next'); if (next) location.href = next;
})();
</script>`;

test('AZWAH Chromium canvas protection and hardware/graphics identity are observed in the browser', { timeout: 600_000 }, async () => {
  assert.equal(process.platform, 'win32');
  assert.equal(process.env.AZWAH_NATIVE_CHROMIUM_CANVAS, '1');
  assert.equal(process.env.AZWAH_NATIVE_CHROMIUM_IDENTITY, '1');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-fp-live-'));
  process.env.PM_DATA_DIR = directory;
  process.env.PM_API_TOKEN = randomUUID();
  const reports = [];
  let waiting = null;
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/report') {
      let body = ''; req.on('data', c => { body += c; }); req.on('end', () => { reports.push(JSON.parse(body)); res.end('ok'); waiting?.(); });
      return;
    }
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
  // One session visits site A, reloads A, then site B (http://localhost).
  const visit = async (profileId) => {
    reports.length = 0;
    const b = `http://localhost:${port}/b?step=b&report=${port}`;
    const a2 = `http://127.0.0.1:${port}/a?step=a2&report=${port}&next=${encodeURIComponent(b)}`;
    const a1 = `http://127.0.0.1:${port}/a?step=a1&report=${port}&next=${encodeURIComponent(a2)}`;
    await api('POST', `/profiles/${profileId}/launch`, { url: a1 }, 200);
    const deadline = Date.now() + 90_000;
    while (reports.length < 3 && Date.now() < deadline) await new Promise(r => { waiting = r; setTimeout(r, 1000); });
    await api('POST', `/profiles/${profileId}/stop`, null, 200);
    assert.equal(reports.length, 3, 'three probe reports: ' + JSON.stringify(reports));
    return Object.fromEntries(reports.map(r => [r.step, r]));
  };
  try {
    const off = (await api('POST', '/profiles', { name: 'fp off', advancedSettings: { runtime: 'azwah-native' } }, 201)).id;
    const on = (await api('POST', '/profiles', { name: 'fp on', advancedSettings: { runtime: 'azwah-native',
      experimental: { canvasReadback: 'prototype', hardwareIdentity: 'prototype', ...(AUDIO_SCREEN && { audioReadback: 'prototype' }) } } }, 201)).id;

    const base = await visit(off);
    console.log('# protection off ' + JSON.stringify(base));
    assert.equal(base.a1.dataUrl, base.b.dataUrl, 'without protection the canvas is identical on both sites (control)');

    const run1 = await visit(on);
    console.log('# protection on ' + JSON.stringify(run1));
    assert.equal(run1.a1.dataUrl, run1.a2.dataUrl, 'stable within a site in one session');
    assert.equal(run1.a1.pixels, run1.a2.pixels);
    assert.notEqual(run1.a1.dataUrl, run1.b.dataUrl, 'different between sites');
    assert.notEqual(run1.a1.pixels, run1.b.pixels);
    assert.notEqual(run1.a1.dataUrl, base.a1.dataUrl, 'differs from the unprotected value');
    const run2 = await visit(on);
    assert.notEqual(run2.a1.dataUrl, run1.a1.dataUrl, 'a new launch gives a new value');

    const expected = nativeIdentityFor(on);
    for (const r of [run1.a1, run1.b, run2.a1]) {
      assert.equal(r.cores, expected.hardwareConcurrency);
      assert.equal(r.memory, expected.deviceMemory);
      if (base.a1.renderer !== null) {
        assert.equal(r.renderer, expected.webglRenderer);
        assert.equal(r.vendor, expected.webglVendor);
      }
      if (AUDIO_SCREEN) assert.equal(r.screen, expected.screen, 'screen size follows the profile');
      if (GPU_FONTS) {
        assert.equal(r.fonts.arial, true, 'a standard Windows font stays available');
        // Proof only when the control profile shows that font as installed on this machine.
        if (base.a1.fonts.notInList) assert.equal(r.fonts.notInList, false, 'a font outside the profile list behaves as not installed');
        if (r.gpuVendor !== null) assert.equal(r.gpuVendor, expected.webgpuVendor, 'WebGPU vendor follows the profile');
      }
    }
    if (GPU_FONTS) {
      // Fonts this machine has (control) that are outside the profile's list must behave as not installed.
      const hidden = Object.keys(base.a1.fontList).filter(f => base.a1.fontList[f] && !expected.fonts.includes(f.toLowerCase()));
      const kept = Object.keys(base.a1.fontList).filter(f => base.a1.fontList[f] && expected.fonts.includes(f.toLowerCase()));
      console.log(`# fonts: installed outside list=${JSON.stringify(hidden)} installed inside list=${JSON.stringify(kept)}`);
      for (const f of hidden) assert.equal(run1.a1.fontList[f], false, `${f} is outside the profile list and must look not installed`);
      for (const f of kept) assert.equal(run1.a1.fontList[f], true, `${f} is in the profile list and must stay available`);
      if (base.a1.renderer !== null) assert.notEqual(run1.a1.renderer, base.a1.renderer, 'the real GPU name is not shown');
    }
    if (RECTS_UA) {
      assert.equal(base.a1.rects, base.b.rects, 'without protection element sizes are the same (control)');
      assert.notEqual(run1.a1.rects, base.a1.rects, 'ClientRects differ from the unprotected values');
      assert.equal(run1.a1.rects, run1.a2.rects, 'ClientRects are stable within a session');
      assert.notEqual(run2.a1.rects, run1.a1.rects, 'a new launch gives new ClientRects');
      if (base.a1.webglPixels) {
        assert.equal(base.a1.webglPixels, base.b.webglPixels, 'WebGL readback identical without protection (control)');
        assert.notEqual(run1.a1.webglPixels, run1.b.webglPixels, 'WebGL readback differs between sites');
        assert.equal(run1.a1.webglPixels, run1.a2.webglPixels, 'WebGL readback stable within a site');
      }
      assert.ok(run1.a1.hints, 'client hints measured');
      assert.equal(run1.a1.hints.platformVersion, expected.platformVersion, 'client-hint Windows version follows the profile');
      assert.ok(run1.a1.hints.brands.includes('Google Chrome'), 'Google Chrome brand reported');
    }
    if (AUDIO_SCREEN) {
      assert.ok(base.a1.audio && run1.a1.audio, 'audio fingerprint measured');
      assert.equal(base.a1.audio, base.b.audio, 'without protection the audio value is the same (control)');
      assert.notEqual(run1.a1.audio, base.a1.audio, 'audio value differs from the unprotected value');
      assert.notEqual(run2.a1.audio, run1.a1.audio, 'a new launch gives a new audio value');
    }
    console.log(`# AZWAH_FINGERPRINT_LIVE pass identity=${JSON.stringify(expected)} realRenderer=${JSON.stringify(base.a1.renderer)} realCores=${base.a1.cores}`);
  } finally {
    for (const id of engine.runningIds()) await engine.stop(id).catch(() => {});
    await app.close();
    server.close();
    db.close();
    fs.rmSync(directory, { force: true, recursive: true, maxRetries: 8, retryDelay: 500 });
  }
});
