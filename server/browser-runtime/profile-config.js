// Phase 2: single validated view of per-profile privacy / identity settings (no fake controls).
import { validateBrowserSettings, DEFAULT_BROWSER_SETTINGS } from '../browser-settings.js';
import { validateWebRtcSettings, DEFAULT_WEBRTC_SETTINGS } from '../webrtc-policy.js';
import { validateAdvancedSettings } from '../advanced-settings.js';
import { buildUserAgent } from '../advanced-launch.js';
import { chromiumIdentity } from '../chromium-identity.js';
import { getSetting } from '../db.js';
import fs from 'fs';

export function buildProfileConfigModel(profile, { platform = process.platform, headless = false } = {}) {
  const browserSettings = validateBrowserSettings(profile.browserSettings || DEFAULT_BROWSER_SETTINGS);
  const webrtcSettings = validateWebRtcSettings(profile.webrtcSettings || DEFAULT_WEBRTC_SETTINGS);
  const advancedSettings = validateAdvancedSettings(profile.advancedSettings || {});
  const executablePath = getSetting('executablePath', '') || '';
  const identity = chromiumIdentity(executablePath && fs.existsSync(executablePath) ? executablePath : '');
  let userAgentPreview = null;
  if (advancedSettings.userAgent.mode !== 'default' && identity.version) {
    try {
      userAgentPreview = buildUserAgent({
        version: identity.version,
        platform,
        headless,
        mode: advancedSettings.userAgent.mode,
      });
    } catch { userAgentPreview = { error: 'UA_VERSION_UNAVAILABLE' }; }
  }
  return {
    profileId: profile.id,
    browserSettings,
    webrtcSettings,
    advancedSettings,
    chromiumIdentity: identity,
    userAgentPreview,
    persistence: ['userDataDir on disk', 'Default/Preferences merge', 'SQLite profile row'],
  };
}
