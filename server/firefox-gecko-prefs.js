// Stock Firefox user.js lines and launch env derived from shared profile settings (not Chromium flags).
import { validateWebRtcSettings, DEFAULT_WEBRTC_SETTINGS } from './webrtc-policy.js';

/** @returns {string[]} user_pref lines (without trailing newlines) */
export function geckoWebRtcUserPrefLines(webrtcSettings = DEFAULT_WEBRTC_SETTINGS) {
  const { mode } = validateWebRtcSettings(webrtcSettings);
  if (mode === 'browser_default' || mode === 'default') return [];
  // Closest stock Gecko ICE restrictions; not equivalent to Chromium --force-webrtc-ip-handling-policy.
  if (mode === 'disable_non_proxied_udp' || mode === 'default_public_interface_only') {
    return [
      'user_pref("media.peerconnection.ice.proxy_only", true);',
      'user_pref("media.peerconnection.ice.no_host", true);',
    ];
  }
  return [];
}

export const GECKO_TIMEZONE_PREF_NOTE = 'privacy.timezone.override is not a documented stock Firefox preference. Unix launches set TZ. This line does not change the timezone by itself.';

export function geckoTimezoneUserPrefLine(timezoneId) {
  const tz = String(timezoneId || '').trim();
  if (!tz) return null;
  return `user_pref("privacy.timezone.override", "${tz.replace(/"/g, '')}");`;
}

export function geckoTimezoneEnv(timezoneId) {
  const tz = String(timezoneId || '').trim();
  return tz || null;
}
