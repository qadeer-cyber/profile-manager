// M15: stock Chromium privacy — actual controls vs observation-only diagnostics.
import { fingerprintCapabilityReport } from './fingerprint-capabilities.js';
import { WEBRTC_MODES } from './webrtc-policy.js';

const CATEGORIES = Object.freeze([
  {
    id: 'canvas',
    title: 'Canvas privacy / reproducibility',
    stockSupport: 'Real readback only; no stable cross-machine noise in stock builds.',
    controls: ['Per-profile real canvas hash observation', 'Restart stability check via canvasSha256'],
    diagnostics: ['Canvas probe SHA-256 in /hardware', 'Consistency finding canvas_readback'],
    customEngine: 'Persistent canvas noise layer in compositor/readback path',
  },
  {
    id: 'audio',
    title: 'AudioContext privacy',
    stockSupport: 'Real OfflineAudioContext render; no noise injection API.',
    controls: ['Real audio render observation', 'Restart stability via audioSha256'],
    diagnostics: ['Audio probe in /hardware', 'Consistency finding audio_readback'],
    customEngine: 'Audio buffer noise hook',
  },
  {
    id: 'webgl',
    title: 'WebGL metadata / restriction',
    stockSupport: '--disable-webgl removes context; vendor/renderer not spoofable.',
    controls: ['WebGL restricted (--disable-webgl)', 'Default real UNMASKED_VENDOR/RENDERER observation'],
    diagnostics: ['webgl_restriction consistency', 'webgl_metadata unsupported finding'],
    customEngine: 'GL string override + graphics noise',
  },
  {
    id: 'webgpu',
    title: 'WebGPU exposure',
    stockSupport: 'Adapter info read-only; disable flag unreliable for navigator.gpu removal.',
    controls: [],
    diagnostics: ['WebGPU adapter probe', 'Finding documents no spoof mode'],
    customEngine: 'Adapter info override / feature disable at source',
  },
  {
    id: 'fonts',
    title: 'Font enumeration / measurement',
    stockSupport: 'local-fonts permission deny only; canvas font metrics remain.',
    controls: ['fonts restricted → CDP local-fonts denied'],
    diagnostics: ['Permission state in hardware report'],
    customEngine: 'Font list substitution / measurement hook',
  },
  {
    id: 'media_devices',
    title: 'Media device enumeration',
    stockSupport: 'enumerateDevices real; deny camera/mic permissions only.',
    controls: ['mediaDevices restricted', 'Per-permission allow/deny/ask'],
    diagnostics: ['Device count/kinds observation', 'Labels after grant only'],
    customEngine: 'Synthetic device list',
  },
  {
    id: 'navigator_hw',
    title: 'Navigator hardware information',
    stockSupport: 'hardwareConcurrency/deviceMemory not per-profile in Chromium.',
    controls: ['User-agent reduced/full from installed version', 'Platform = host OS token'],
    diagnostics: ['navigator_custom unsupported finding', 'Client hints version check'],
    customEngine: 'Blink navigator property overrides',
  },
  {
    id: 'webrtc_network',
    title: 'WebRTC network information',
    stockSupport: 'IP handling policy flags; not proxy-IP synthesis.',
    controls: WEBRTC_MODES.map(mode => `webrtc mode ${mode}`),
    diagnostics: ['ICE candidate type summary', 'webrtc_proxy_match unsupported', 'Policy flag consistency'],
    customEngine: 'ICE / candidate filtering tied to proxy IP',
  },
  {
    id: 'local_network',
    title: 'Local network / port access',
    stockSupport: 'Chromium private-network feature set; app refuses to weaken flags.',
    controls: ['portScan fixed real — no whitelist mask', 'Launch args must not disable PNA/LNA checks'],
    diagnostics: ['private_network consistency on command line'],
    customEngine: 'Masked port-scan API responses',
  },
]);

export function privacyEngineReport(opts = {}) {
  const capabilities = fingerprintCapabilityReport(opts);
  return {
    generatedAt: new Date().toISOString(),
    platform: opts.platform || process.platform,
    categories: CATEGORIES,
    capabilities,
    customEngineRequired: capabilities.customChromiumRequired,
    feasibility: {
      recommendation: 'Remain on pinned stock Chromium until a dedicated team owns CVE merges, build farms, and M3–M16 regression on Windows hardware.',
      dependency: 'Separate signed Chromium/Playwright revision fork; not bundled in Alpha.2.',
      maintenance: 'Weekly upstream merges, SHA-verified installs, HD 620 + proxy matrix on Latitude 5480.',
      verification: 'Full npm test:m10–m16 on Windows; no Linux substitute for GPU/proxy claims.',
    },
    observation: 'Categories separate implemented controls from diagnostics. Neither implies undetectable browsing.',
  };
}
