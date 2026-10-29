// Honest capability map for stock Chromium on this host. No fabricated controls.
import { FINGERPRINT_CONTROLS, FINGERPRINT_FIXED, FINGERPRINT_REJECTED } from './fingerprint-settings.js';
import { WEBRTC_MODES } from './webrtc-policy.js';

export const CUSTOM_CHROMIUM_NEEDS = Object.freeze([
  'Canvas readback noise that stays stable across machines',
  'AudioContext render noise that stays stable across machines',
  'Substitute WebGL or WebGPU vendor and renderer strings',
  'Substitute installed-font measurement or a font hash list',
  'Invented camera, microphone, or speaker device lists',
  'Masked local port-scan results and a custom port whitelist',
  'WebRTC addresses that track a proxy IP automatically',
  'Per-profile hardwareConcurrency, deviceMemory, or OSCPU overrides',
  'Turning WebRTC or the Canvas API fully off without breaking pages',
  'A WebGPU-off switch that removes navigator.gpu on every build',
]);

export function fingerprintCapabilityReport({ platform = process.platform } = {}) {
  const controls = FINGERPRINT_CONTROLS.map(item => ({
    id: item.id,
    label: item.label,
    supportedModes: item.modes.map(mode => mode.id),
    note: item.note,
  }));
  const fixed = FINGERPRINT_FIXED.map(item => ({ id: item.id, label: item.label, mode: item.mode, reason: item.reason }));
  const rejected = FINGERPRINT_REJECTED.map(([surface, mode]) => ({ surface, mode }));
  return {
    platform,
    controls,
    fixed,
    rejectedSample: rejected.slice(0, 8),
    rejectedCount: rejected.length,
    webrtcModes: [...WEBRTC_MODES],
    customChromiumRequired: CUSTOM_CHROMIUM_NEEDS,
    observation: 'Capabilities describe stock Chromium and this app’s validators. They are not a stealth or anonymity guarantee.',
  };
}
