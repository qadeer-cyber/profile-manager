// Per-profile WebRTC policy. Only Chromium's real IP-handling policies are accepted.
// browser_default adds no flag and leaves Chromium's own behavior in place.
// There is no supported switch that turns WebRTC off, spoofs an address, or promises zero leaks.
export const WEBRTC_MODES = Object.freeze([
  'browser_default',
  'default',
  'default_public_and_private_interfaces',
  'default_public_interface_only',
  'disable_non_proxied_udp',
]);
export const FORCED_WEBRTC_POLICIES = Object.freeze(WEBRTC_MODES.filter(mode => mode !== 'browser_default'));
export const DEFAULT_WEBRTC_SETTINGS = Object.freeze({ mode: 'browser_default' });
export const WEBRTC_CHOICES = Object.freeze([
  ['browser_default', 'Browser default (no policy flag)'],
  ['default', 'Chromium policy: default'],
  ['default_public_and_private_interfaces', 'Public and private interfaces'],
  ['default_public_interface_only', 'Public interface only'],
  ['disable_non_proxied_udp', 'Disable non-proxied UDP (strongest supported restriction)'],
]);
const MODES = new Set(WEBRTC_MODES);
const invalid = message => { throw Object.assign(new Error(message), { status: 400, code: 'INVALID_WEBRTC_SETTINGS' }); };

export function validateWebRtcSettings(value, previous = DEFAULT_WEBRTC_SETTINGS) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('webrtcSettings must be an object');
  if (Object.keys(value).some(key => key !== 'mode')) invalid('Unknown webrtcSettings field');
  const out = { mode: previous.mode };
  if ('mode' in value) {
    if (typeof value.mode !== 'string' || !MODES.has(value.mode)) {
      invalid('Unsupported WebRTC mode. Chromium cannot turn WebRTC off or spoof addresses. Supported modes: ' + WEBRTC_MODES.join(', '));
    }
    out.mode = value.mode;
  }
  return out;
}

// One Chromium force flag, or none. browser_default must not pass the flag:
// an absent flag is the real default and is what process inspection reports.
export function chromiumPolicyArgs(value = DEFAULT_WEBRTC_SETTINGS) {
  const { mode } = validateWebRtcSettings(value);
  return mode === 'browser_default' ? [] : [`--force-webrtc-ip-handling-policy=${mode}`];
}
