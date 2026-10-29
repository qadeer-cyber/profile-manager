// Per-profile fingerprint controls that stock Chromium can actually apply.
// Modes that would invent a GPU, font list, media device, canvas image, audio
// hash, WebRTC address, or browser version are rejected.
export const DEFAULT_FINGERPRINT = Object.freeze({
  webgl: 'default',
  fonts: 'real',
  mediaDevices: 'real',
  canvas: 'real',
  audio: 'real',
  portScan: 'real',
});

export const WEBGL_DISABLE_ARG = '--disable-webgl';

export const FINGERPRINT_CONTROLS = Object.freeze([
  Object.freeze({
    id: 'webgl',
    label: 'WebGL',
    modes: Object.freeze([
      Object.freeze({ id: 'default', label: 'Default — real GPU' }),
      Object.freeze({ id: 'restricted', label: 'Restricted — turn WebGL off' }),
    ]),
    note: 'Restricted passes --disable-webgl. The vendor and renderer are never replaced with different names.',
  }),
  Object.freeze({
    id: 'fonts',
    label: 'Local fonts',
    modes: Object.freeze([
      Object.freeze({ id: 'real', label: 'Real — Chromium decides' }),
      Object.freeze({ id: 'restricted', label: 'Restricted — deny local font access' }),
    ]),
    note: 'Restricted denies the local-fonts permission when a page opens. Measuring installed fonts through canvas is not blocked.',
  }),
  Object.freeze({
    id: 'mediaDevices',
    label: 'Camera and microphone',
    modes: Object.freeze([
      Object.freeze({ id: 'real', label: 'Real — use the permission settings' }),
      Object.freeze({ id: 'restricted', label: 'Restricted — deny camera and microphone' }),
    ]),
    note: 'Restricted does not invent cameras or microphones. Device names stay whatever this computer exposes.',
  }),
]);

export const FINGERPRINT_FIXED = Object.freeze([
  Object.freeze({ id: 'canvas', label: 'Canvas', mode: 'real', reason: 'The readback is the browser’s own image. Noise and a canvas-off switch are not offered: this Chromium build has no such control.' }),
  Object.freeze({ id: 'audio', label: 'AudioContext', mode: 'real', reason: 'The render is the browser’s own audio path. Noise is not offered.' }),
  Object.freeze({ id: 'portScan', label: 'Port scan', mode: 'real', reason: 'Local port probes keep Chromium’s own result. Masked results and a port whitelist are not offered. This app does not turn private-network checks off.' }),
  Object.freeze({ id: 'webgpu', label: 'WebGPU', mode: 'observed', reason: 'Metadata is not replaced. On the Linux test host, navigator.gpu stayed present and requestAdapter returned no adapter with or without --disable-features=WebGPU, so a disable switch is not offered.' }),
]);

export const FINGERPRINT_REJECTED = Object.freeze([
  ['webgl', 'masked', 'WebGL vendor and renderer cannot be replaced. Choose Default or Restricted.'],
  ['webgl', 'custom', 'A custom WebGL vendor or renderer would be an invented GPU. Choose Default or Restricted.'],
  ['webgl', 'noise', 'WebGL image noise needs a custom Chromium. This build does not add it.'],
  ['fonts', 'masked', 'A substitute font list needs a custom Chromium. Restricted only denies the local-fonts permission.'],
  ['fonts', 'custom', 'This app does not accept a made-up font list.'],
  ['mediaDevices', 'masked', 'Substitute cameras and microphones need a custom Chromium. Restricted only denies capture.'],
  ['mediaDevices', 'custom', 'Device counts and names cannot be invented.'],
  ['canvas', 'noise', 'Canvas noise needs a custom Chromium. Canvas stays on the real readback.'],
  ['canvas', 'disabled', 'This Chromium build has no supported switch that turns the canvas API off.'],
  ['canvas', 'masked', 'Canvas cannot be replaced with another image.'],
  ['audio', 'noise', 'AudioContext noise needs a custom Chromium. Audio stays on the real render.'],
  ['audio', 'masked', 'AudioContext output cannot be replaced.'],
  ['portScan', 'masked', 'Masked port-scan results need a custom Chromium. The real browser result is kept.'],
  ['portScan', 'custom', 'A port whitelist that hides other local ports is not a stock Chromium setting.'],
  ['webgpu', 'masked', 'WebGPU vendor and device ids cannot be replaced.'],
  ['webgpu', 'custom', 'Custom WebGPU vendor and device ids would be invented hardware.'],
  ['webgpu', 'restricted', 'A WebGPU-off switch is not offered. Disabling the feature did not remove navigator.gpu on the tested Chromium, and no adapter was available to verify a change.'],
  ['navigator', 'custom', 'hardwareConcurrency, deviceMemory, platform, and OSCPU cannot be set to other values. OSCPU is a Firefox field. Platform stays this computer’s platform.'],
]);

const invalid = message => {
  throw Object.assign(new Error(message), { status: 400, code: 'INVALID_ADVANCED_SETTINGS', tab: 'fingerprint' });
};

function rejected(surface, mode) {
  const hit = FINGERPRINT_REJECTED.find(item => item[0] === surface && item[1] === mode);
  if (hit) invalid(hit[2]);
}

function choice(surface, value, allowed) {
  if (typeof value !== 'string') invalid(`${surface} must be a string`);
  rejected(surface, value);
  if (!allowed.includes(value)) invalid(`${surface} must be ${allowed.join(' or ')}`);
  return value;
}

export function validateFingerprint(value, preferences) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  if (!input) invalid('fingerprint must be an object');
  const allowed = ['webgl', 'fonts', 'mediaDevices', 'canvas', 'audio', 'portScan'];
  if (Object.keys(input).some(key => !allowed.includes(key))) invalid('Unknown fingerprint field. Navigator, WebGPU metadata, noise, and masked values are not settings.');
  const out = {
    webgl: 'webgl' in input ? choice('webgl', input.webgl, ['default', 'restricted']) : DEFAULT_FINGERPRINT.webgl,
    fonts: 'fonts' in input ? choice('fonts', input.fonts, ['real', 'restricted']) : DEFAULT_FINGERPRINT.fonts,
    mediaDevices: 'mediaDevices' in input ? choice('mediaDevices', input.mediaDevices, ['real', 'restricted']) : DEFAULT_FINGERPRINT.mediaDevices,
    canvas: 'canvas' in input ? choice('canvas', input.canvas, ['real']) : DEFAULT_FINGERPRINT.canvas,
    audio: 'audio' in input ? choice('audio', input.audio, ['real']) : DEFAULT_FINGERPRINT.audio,
    portScan: 'portScan' in input ? choice('portScan', input.portScan, ['real']) : DEFAULT_FINGERPRINT.portScan,
  };
  const camera = preferences?.permissions?.camera;
  const microphone = preferences?.permissions?.microphone;
  if (out.mediaDevices === 'restricted' && (camera === 'allow' || microphone === 'allow')) {
    invalid('Camera and microphone cannot be Allow while media devices are Restricted.');
  }
  return out;
}

export function fingerprintLaunchArgs(fingerprint = DEFAULT_FINGERPRINT) {
  const mode = fingerprint?.webgl || 'default';
  return mode === 'restricted' ? [WEBGL_DISABLE_ARG] : [];
}

export function verifyFingerprintLaunchArgs(args, fingerprint = DEFAULT_FINGERPRINT) {
  const expected = fingerprintLaunchArgs(fingerprint);
  return expected.every(flag => args.includes(flag)) && (fingerprint?.webgl === 'restricted' || !args.includes(WEBGL_DISABLE_ARG));
}

const WEAKENING_FEATURES = Object.freeze([
  'PrivateNetworkAccessSendPreflights',
  'PrivateNetworkAccessRespectPreflightResults',
  'BlockInsecurePrivateNetworkRequests',
  'LocalNetworkAccessChecks',
]);

export function privateNetworkWeakening(commandLine) {
  if (typeof commandLine !== 'string' || !commandLine.trim()) return { availability: 'unavailable', features: [] };
  const features = [];
  for (const match of commandLine.matchAll(/--disable-features=(\S+)/g)) features.push(...match[1].split(',').filter(Boolean));
  return { availability: 'observed', features: WEAKENING_FEATURES.filter(name => features.includes(name)) };
}
