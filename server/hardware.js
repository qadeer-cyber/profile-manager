// Observed hardware facts. This module does not set overrides for concurrency,
// memory, WebGL, or fonts. Missing facts stay unavailable or unsupported.
import os from 'os';

async function observeInPage() {
  const text = value => typeof value === 'string' ? value.slice(0, 300) : null;
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
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
  const concurrency = number(navigator.hardwareConcurrency);
  const memory = number(navigator.deviceMemory);
  return {
    hardwareConcurrency: concurrency == null ? { availability: 'unavailable', reason: 'not_exposed' } : { availability: 'observed', source: 'browser', value: concurrency },
    deviceMemory: memory == null ? { availability: 'unavailable', reason: 'not_exposed' } : { availability: 'observed', source: 'browser', value: memory },
    webgl, media,
    userAgent: text(navigator.userAgent),
    screen: { width: number(screen.width), height: number(screen.height), devicePixelRatio: number(window.devicePixelRatio), innerWidth: number(window.innerWidth), innerHeight: number(window.innerHeight) },
  };
}

export function hostHardware() {
  const cpus = os.cpus();
  return {
    hardwareConcurrency: { availability: 'observed', source: 'host', label: 'observed', value: cpus.length },
    deviceMemoryGiB: { availability: 'observed', source: 'host', label: 'observed', value: Math.round(os.totalmem() / 1024 / 1024 / 1024), note: 'Host RAM rounded to GiB. navigator.deviceMemory is a browser bucket and is reported separately when a profile is running.' },
  };
}

export const UNSUPPORTED_OVERRIDES = Object.freeze([
  { fact: 'hardwareConcurrency', availability: 'unsupported', reason: 'Chromium has no supported per-profile hardwareConcurrency setting. Observed values are not simulated.' },
  { fact: 'deviceMemory', availability: 'unsupported', reason: 'Chromium has no supported per-profile deviceMemory setting. Observed values are not simulated.' },
  { fact: 'webgl', availability: 'unsupported', reason: 'This app does not replace the GPU vendor or renderer.' },
  { fact: 'fonts', availability: 'unsupported', reason: 'Chromium does not expose the installed font list without a permission prompt. This app does not prompt or invent a font list.' },
]);

export async function observeBrowser(ctx) {
  if (!ctx) return { availability: 'unavailable', reason: 'not_running' };
  const page = await ctx.newPage();
  try {
    const facts = await page.evaluate(observeInPage);
    return { availability: 'observed', source: 'browser', ...facts };
  } catch {
    return { availability: 'unavailable', reason: 'collection_failed' };
  } finally {
    await page.close().catch(() => {});
  }
}
