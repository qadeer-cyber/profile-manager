// One catalog of every fingerprint category the profile editor shows.
//
// Each category lists every mode people ask for (Real, Masked, Custom, Noise, Disabled, ...).
// A mode is:
//   supported   - this app applies it with a real Chromium/Firefox switch, permission or launch option
//   conditional - real, but only on the runtimes/settings named in `requires`
//   unsupported - shown so the gap is visible, never selectable, and rejected by the validators
// `verifiedBy` names the fingerprint-consistency findings that compare the saved value with what a
// running browser actually exposed. Nothing here fabricates a value.
import { FINGERPRINT_REJECTED } from './fingerprint-settings.js';

const reasonFor = (surface, mode, fallback) =>
  FINGERPRINT_REJECTED.find(([s, m]) => s === surface && m === mode)?.[2] || fallback;
const ok = (id, label, extra = {}) => ({ id, label, state: 'supported', ...extra });
const conditional = (id, label, requires) => ({ id, label, state: 'conditional', requires });
const no = (id, label, reason) => ({ id, label, state: 'unsupported', reason });
const FOLLOW_PROXY = 'Chrome Stable or Azwah native runtime with Location mode "Automatically follow proxy" and an assigned proxy. Applied and checked in the browser at launch.';

export const FINGERPRINT_CATEGORIES = Object.freeze([
  { id: 'webrtc', label: 'WebRTC', section: 'webrtc', setting: 'webrtcSettings.mode',
    modes: [
      ok('real', 'Real — browser default or a Chromium IP-handling policy'),
      no('masked', 'Masked — proxy IP', 'Chromium cannot substitute the proxy address into ICE candidates. Use "Disable non-proxied UDP" to restrict instead.'),
      no('custom', 'Custom IP', 'A typed-in WebRTC address would be invented. Stock Chromium has no switch for it.'),
      no('disabled', 'Disabled', 'Stock Chromium has no supported switch that turns WebRTC off without breaking pages.'),
    ],
    verifiedBy: ['webrtc_flag', 'webrtc_proxy_match'] },
  { id: 'timezone', label: 'Timezone', section: 'regional', setting: 'browserSettings.timezoneId',
    modes: [
      ok('real', 'Real — host timezone'),
      ok('custom', 'Custom — IANA timezone'),
      conditional('masked', 'Masked — follow proxy location', FOLLOW_PROXY),
    ],
    verifiedBy: ['timezone', 'timezone_offset'] },
  { id: 'languages', label: 'Languages and locale', section: 'regional', setting: 'browserSettings.languages / locale',
    modes: [
      ok('real', 'Real — host languages'),
      ok('custom', 'Custom — ordered language list'),
      no('masked', 'Masked — follow proxy country', 'Languages are never guessed from a proxy country. Enter them explicitly.'),
    ],
    verifiedBy: ['languages', 'locale', 'intl_locale'] },
  { id: 'geolocationAccess', label: 'Geolocation access', section: 'location', setting: 'advancedSettings.geolocation.permission',
    modes: [ok('default', 'Browser default'), ok('ask', 'Prompt'), ok('allow', 'Allow'), ok('deny', 'Block')],
    verifiedBy: ['geolocation', 'geolocation_scope'] },
  { id: 'geolocationData', label: 'Geolocation data', section: 'location', setting: 'advancedSettings.geolocation.mode',
    modes: [
      ok('real', 'Real — system location'),
      ok('custom', 'Custom — manual coordinates'),
      conditional('masked', 'Masked — follow proxy location', FOLLOW_PROXY),
    ],
    verifiedBy: ['geolocation', 'geolocation_native'] },
  { id: 'screen', label: 'Screen resolution', section: 'window', setting: 'advancedSettings.screen',
    modes: [
      ok('real', 'Real — native window'),
      ok('custom', 'Custom — window, viewport and scale'),
      no('masked', 'Masked — generated screen', 'A generated screen would not match the real window. Choose a preset or custom size instead.'),
    ],
    verifiedBy: ['screen', 'screen_monitor'] },
  { id: 'userAgent', label: 'User agent', section: 'navigator', setting: 'advancedSettings.userAgent.mode',
    modes: [
      ok('default', 'Browser default'), ok('reduced', 'Reduced'), ok('full', 'Full'),
      no('custom', 'Custom string', 'A free-form user agent naming another browser version would disagree with client hints and is rejected.'),
    ],
    verifiedBy: ['ua_version', 'ua_client_hints', 'ua_engine_coherence', 'ua_hint_pin'] },
  { id: 'navigatorHardware', label: 'Navigator hardware and platform', section: 'navigator', setting: 'none — always real',
    modes: [ok('real', 'Real — this computer'), no('custom', 'Custom values', reasonFor('navigator', 'custom'))],
    verifiedBy: ['host_platform', 'navigator_custom'] },
  { id: 'fonts', label: 'Fonts', section: 'graphics', setting: 'advancedSettings.fingerprint.fonts',
    modes: [
      ok('real', 'Real'), ok('restricted', 'Restricted — deny local font access'),
      no('masked', 'Masked', reasonFor('fonts', 'masked')), no('custom', 'Custom list', reasonFor('fonts', 'custom')),
    ],
    verifiedBy: ['fonts_permission', 'fonts_query_api', 'fonts_mask'] },
  { id: 'mediaDevices', label: 'Media devices', section: 'graphics', setting: 'advancedSettings.fingerprint.mediaDevices',
    modes: [
      ok('real', 'Real'), ok('restricted', 'Restricted — deny camera and microphone'),
      no('masked', 'Masked', reasonFor('mediaDevices', 'masked')), no('custom', 'Custom devices', reasonFor('mediaDevices', 'custom')),
    ],
    verifiedBy: ['media_permission', 'media_enumeration', 'media_capture', 'media_mask'] },
  { id: 'webglMetadata', label: 'WebGL metadata', section: 'graphics', setting: 'none — always real',
    modes: [ok('real', 'Real — this GPU'), no('masked', 'Masked', reasonFor('webgl', 'masked')), no('custom', 'Custom vendor/renderer', reasonFor('webgl', 'custom'))],
    verifiedBy: ['webgl_metadata'] },
  { id: 'webgl', label: 'WebGL graphics', section: 'graphics', setting: 'advancedSettings.fingerprint.webgl',
    modes: [ok('default', 'Real'), ok('restricted', 'Restricted — WebGL off'), no('noise', 'Noise', reasonFor('webgl', 'noise'))],
    verifiedBy: ['webgl_restriction'] },
  { id: 'canvas', label: 'Canvas', section: 'graphics', setting: 'advancedSettings.fingerprint.canvas',
    modes: [ok('real', 'Real'), no('noise', 'Noise', reasonFor('canvas', 'noise')), no('masked', 'Masked', reasonFor('canvas', 'masked')), no('disabled', 'Disabled', reasonFor('canvas', 'disabled'))],
    verifiedBy: ['canvas_readback', 'canvas_noise', 'restart_fingerprint'] },
  { id: 'audio', label: 'AudioContext', section: 'graphics', setting: 'advancedSettings.fingerprint.audio',
    modes: [ok('real', 'Real'), no('noise', 'Noise', reasonFor('audio', 'noise')), no('masked', 'Masked', reasonFor('audio', 'masked'))],
    verifiedBy: ['audio_readback', 'audio_noise'] },
  { id: 'webgpu', label: 'WebGPU', section: 'graphics', setting: 'none — always real',
    modes: [ok('real', 'Real — observed'), no('masked', 'Masked', reasonFor('webgpu', 'masked')), no('custom', 'Custom', reasonFor('webgpu', 'custom')), no('restricted', 'Disabled', reasonFor('webgpu', 'restricted'))],
    verifiedBy: ['webgpu_metadata'] },
  { id: 'portScan', label: 'Port scan protection', section: 'ports', setting: 'advancedSettings.fingerprint.portScan',
    modes: [ok('real', 'Real — browser private-network checks stay on'), no('masked', 'Masked', reasonFor('portScan', 'masked')), no('custom', 'Custom whitelist', reasonFor('portScan', 'custom'))],
    verifiedBy: ['port_scan_policy', 'port_scan_mask', 'local_network_access'] },
].map(category => Object.freeze({ ...category, modes: Object.freeze(category.modes.map(Object.freeze)), verifiedBy: Object.freeze(category.verifiedBy) })));

export const categoryById = id => FINGERPRINT_CATEGORIES.find(category => category.id === id) || null;

// Group consistency findings into one verification row per category.
// "unsupported" findings are informational ("noise is not applied") and never count as a check.
//   warning     - a compared value disagreed with the browser
//   pass        - every comparable check passed
//   partial     - some checks passed, the rest could not be observed
//   unavailable - nothing comparable was observed (for example the profile is not running)
//   real-only   - the category has no setting to compare; only informational notes exist
export function verificationByCategory(findings = []) {
  const byId = new Map();
  for (const item of findings) { if (!byId.has(item.id)) byId.set(item.id, []); byId.get(item.id).push(item); }
  return FINGERPRINT_CATEGORIES.map(category => {
    const items = category.verifiedBy.flatMap(id => byId.get(id) || []);
    const checks = items.filter(item => item.status !== 'unsupported');
    let status;
    if (checks.some(item => item.status === 'warning')) status = 'warning';
    else if (checks.length && checks.every(item => item.status === 'pass')) status = 'pass';
    else if (checks.some(item => item.status === 'pass')) status = 'partial';
    else if (checks.length) status = 'unavailable';
    else status = items.length ? 'real-only' : 'unavailable';
    return { id: category.id, label: category.label, status, findings: items };
  });
}
