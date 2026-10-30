// Observed hardware and fingerprint facts. Values come from the live page or the
// host. Missing facts stay unavailable. Nothing here is simulated.
import crypto from 'crypto';
import http from 'http';
import os from 'os';
import { applyDocumentPermissions } from './advanced-launch.js';
import { gatherIceInPage, summarizeIceCandidates } from './webrtc-observe.js';

async function observeInPage() {
  const text = value => typeof value === 'string' ? value.slice(0, 300) : null;
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const permission = async name => {
    try {
      if (!navigator.permissions?.query) return { availability: 'unavailable', reason: 'permissions_api_missing' };
      const status = await navigator.permissions.query({ name });
      return { availability: 'observed', state: status.state };
    } catch {
      return { availability: 'unavailable', reason: 'permission_query_failed' };
    }
  };
  const canvasEl = document.createElement('canvas');
  canvasEl.width = 240;
  canvasEl.height = 60;
  const canvas2d = canvasEl.getContext('2d');
  let canvas = { availability: 'unavailable', reason: 'canvas_2d_unavailable' };
  if (canvas2d) {
    canvas2d.textBaseline = 'top';
    canvas2d.font = '14px Arial';
    canvas2d.fillStyle = '#f60';
    canvas2d.fillRect(0, 0, 240, 20);
    canvas2d.fillStyle = '#069';
    canvas2d.fillText('Profile Manager canvas probe', 2, 2);
    try { canvas = { availability: 'observed', dataUrl: canvasEl.toDataURL() }; }
    catch { canvas = { availability: 'unavailable', reason: 'canvas_read_failed' }; }
  }
  const glCanvas = document.createElement('canvas');
  const gl = glCanvas.getContext('webgl') || glCanvas.getContext('experimental-webgl');
  let webgl = { availability: 'unavailable', reason: 'webgl_unavailable' };
  if (gl) {
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    webgl = {
      availability: 'observed', source: 'webgl',
      vendor: text(gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR)),
      renderer: text(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
      debugExtension: !!debug,
    };
  }
  let webgpu = { availability: 'unavailable', reason: 'webgpu_unavailable', apiPresent: typeof navigator.gpu === 'object' };
  if (navigator.gpu) {
    try {
      const adapter = await Promise.race([
        navigator.gpu.requestAdapter(),
        new Promise(resolve => setTimeout(() => resolve(null), 3000)),
      ]);
      if (!adapter) webgpu = { availability: 'unavailable', reason: 'no_adapter', apiPresent: true };
      else {
        const info = adapter.info || {};
        webgpu = {
          availability: 'observed', apiPresent: true,
          vendor: text(info.vendor), architecture: text(info.architecture),
          device: text(info.device), description: text(info.description),
        };
      }
    } catch { webgpu = { availability: 'unavailable', reason: 'webgpu_failed', apiPresent: true }; }
  }
  let audio = { availability: 'unavailable', reason: 'audio_unavailable' };
  try {
    const context = new OfflineAudioContext(1, 44100, 44100);
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 1000;
    oscillator.connect(context.destination);
    oscillator.start(0);
    const rendered = await context.startRendering();
    const samples = Array.from(rendered.getChannelData(0).slice(0, 32)).map(sample => Math.round(sample * 1e6) / 1e6);
    audio = { availability: 'observed', sampleRate: rendered.sampleRate, samples };
  } catch { audio = { availability: 'unavailable', reason: 'audio_failed' }; }
  let media = { supportedConstraints: null, devices: { availability: 'unavailable', reason: 'media_devices_unavailable' } };
  if (navigator.mediaDevices) {
    try {
      const constraints = navigator.mediaDevices.getSupportedConstraints ? navigator.mediaDevices.getSupportedConstraints() : null;
      const list = await navigator.mediaDevices.enumerateDevices();
      const kinds = [...new Set(list.map(device => device.kind))].slice(0, 12);
      media = {
        supportedConstraints: constraints,
        devices: { availability: 'observed', count: list.length, kinds, labelsAvailable: list.some(device => !!device.label) },
      };
    } catch { media.devices = { availability: 'unavailable', reason: 'media_devices_failed' }; }
  }
  let clientHints = { availability: 'unavailable', reason: 'not_exposed' };
  if (navigator.userAgentData?.getHighEntropyValues) {
    try {
      const high = await navigator.userAgentData.getHighEntropyValues(['fullVersionList', 'uaFullVersion', 'platform']);
      const chromium = Array.isArray(high.fullVersionList) ? high.fullVersionList.find(item => item.brand === 'Chromium') : null;
      clientHints = {
        availability: 'observed',
        uaFullVersion: text(high.uaFullVersion),
        chromiumVersion: text(chromium?.version),
        platform: text(high.platform),
      };
    } catch { clientHints = { availability: 'unavailable', reason: 'client_hints_failed' }; }
  }
  let fontsQuery = { availability: 'unavailable', reason: 'queryLocalFonts_missing' };
  if (typeof window.queryLocalFonts === 'function') {
    try {
      const list = await window.queryLocalFonts();
      fontsQuery = { availability: 'observed', apiPresent: true, resolved: true, count: list.length };
    } catch (error) {
      fontsQuery = { availability: 'observed', apiPresent: true, resolved: false, errorName: error.name };
    }
  } else {
    fontsQuery = { availability: 'observed', apiPresent: false, resolved: false };
  }
  let mediaCapture = { availability: 'unavailable', reason: 'getUserMedia_missing' };
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      mediaCapture = { availability: 'observed', errorName: 'granted' };
    } catch (error) {
      mediaCapture = { availability: 'observed', errorName: error.name || 'Error' };
    }
  }
  const permissions = {
    geolocation: await permission('geolocation'),
    camera: await permission('camera'),
    microphone: await permission('microphone'),
    'local-fonts': await permission('local-fonts'),
    'local-network-access': await permission('local-network-access'),
    notifications: await permission('notifications'),
  };
  let geolocation = null;
  if (permissions.geolocation.state === 'granted' && navigator.geolocation) {
    geolocation = await new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        position => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }),
        () => resolve(null),
        { timeout: 2000, maximumAge: 0 },
      );
    });
  }
  const concurrency = number(navigator.hardwareConcurrency);
  const memory = number(navigator.deviceMemory);
  let timezone = null;
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { timezone = null; }
  return {
    hardwareConcurrency: concurrency == null ? { availability: 'unavailable', reason: 'not_exposed' } : { availability: 'observed', source: 'browser', value: concurrency },
    deviceMemory: memory == null ? { availability: 'unavailable', reason: 'not_exposed' } : { availability: 'observed', source: 'browser', value: memory },
    webgl, webgpu, canvas, audio, media, mediaCapture, fontsQuery, clientHints, permissions, geolocation,
    userAgent: text(navigator.userAgent),
    platform: text(navigator.platform),
    locale: text(navigator.language),
    languages: Array.isArray(navigator.languages) ? navigator.languages.slice(0, 10).map(tag => text(tag)).filter(Boolean) : [],
    timezone: text(timezone),
    screen: { width: number(screen.width), height: number(screen.height), devicePixelRatio: number(window.devicePixelRatio), innerWidth: number(window.innerWidth), innerHeight: number(window.innerHeight) },
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function summarize(facts) {
  if (facts.canvas?.dataUrl) {
    facts.canvas = { availability: 'observed', source: 'canvas_2d', sha256: sha256(facts.canvas.dataUrl), bytes: facts.canvas.dataUrl.length };
  }
  if (facts.audio?.samples) {
    facts.audio = { availability: 'observed', source: 'offline_audio', sampleRate: facts.audio.sampleRate, sha256: sha256(JSON.stringify(facts.audio.samples)) };
  }
  return facts;
}

async function withObservationPage(ctx) {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>observation</title>');
  });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const page = await ctx.newPage();
  return {
    page, url,
    close: async () => {
      await page.close().catch(() => {});
      await new Promise(resolve => server.close(() => resolve()));
    },
  };
}

export function hostHardware() {
  const cpus = os.cpus();
  return {
    hardwareConcurrency: { availability: 'observed', source: 'host', label: 'observed', value: cpus.length },
    deviceMemoryGiB: { availability: 'observed', source: 'host', label: 'observed', value: Math.round(os.totalmem() / 1024 / 1024 / 1024), note: 'Host RAM rounded to GiB. navigator.deviceMemory is a browser bucket and is reported separately when a profile is running.' },
    timezone: { availability: 'observed', source: 'host', value: Intl.DateTimeFormat().resolvedOptions().timeZone },
  };
}

export const UNSUPPORTED_OVERRIDES = Object.freeze([
  { fact: 'hardwareConcurrency', availability: 'unsupported', reason: 'Chromium has no supported per-profile hardwareConcurrency setting. Observed values are not simulated.' },
  { fact: 'deviceMemory', availability: 'unsupported', reason: 'Chromium has no supported per-profile deviceMemory setting. Observed values are not simulated.' },
  { fact: 'webgl', availability: 'unsupported', reason: 'WebGL can be turned off. The vendor and renderer cannot be replaced with different names.' },
  { fact: 'webgpu', availability: 'unsupported', reason: 'WebGPU vendor and device ids are not replaced. A disable switch is not offered: it did not remove navigator.gpu on the tested build, and no adapter was available to verify a change.' },
  { fact: 'fonts', availability: 'unsupported', reason: 'The local-fonts permission can be denied. The installed font list is not replaced, and canvas font measurement is not blocked.' },
  { fact: 'canvas', availability: 'unsupported', reason: 'Canvas noise and a canvas-off switch are not available. The readback is the browser’s own image.' },
  { fact: 'audio', availability: 'unsupported', reason: 'AudioContext noise is not available. The render is the browser’s own audio path.' },
  { fact: 'mediaDevices', availability: 'unsupported', reason: 'Camera and microphone can be denied. Device names and counts are not invented.' },
  { fact: 'portScan', availability: 'unsupported', reason: 'Masked port-scan results and a port whitelist are not available. Chromium’s own private-network behavior is left in place.' },
]);

const OBSERVE_DEADLINE_MS = 35000;

async function collectBrowserObservation(ctx, permissions) {
  let probe;
  try {
    probe = await withObservationPage(ctx);
    await probe.page.goto(probe.url, { timeout: 15000, waitUntil: 'domcontentloaded' });
    if (permissions && Object.keys(permissions).length) await applyDocumentPermissions(probe.page, probe.url, permissions);
    const facts = summarize(await probe.page.evaluate(observeInPage, { timeout: 20000 }));
    const iceRaw = await gatherIceInPage(probe.page);
    facts.webrtcIce = iceRaw.availability === 'observed' ? summarizeIceCandidates(iceRaw.lines) : iceRaw;
    return { availability: 'observed', source: 'browser', ...facts };
  } finally {
    await probe?.close();
  }
}

export async function observeBrowser(ctx, { permissions } = {}) {
  if (!ctx) return { availability: 'unavailable', reason: 'not_running' };
  try {
    return await Promise.race([
      collectBrowserObservation(ctx, permissions),
      new Promise((_, reject) => setTimeout(() => reject(new Error('observe_deadline')), OBSERVE_DEADLINE_MS)),
    ]);
  } catch {
    return { availability: 'unavailable', reason: 'collection_failed' };
  }
}
