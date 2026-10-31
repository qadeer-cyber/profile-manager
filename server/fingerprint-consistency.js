// Compare saved fingerprint settings with what Chromium actually exposed.
// A finding is "pass" only when the compared values were both present.
import { privateNetworkWeakening, WEBGL_DISABLE_ARG } from './fingerprint-settings.js';
import { assessPinnedClientHints, compareEngineIdentity } from './engine-identity.js';
import { assessLanguageList, timezoneOffsetMinutes } from './regional-consistency.js';
import { classifyMediaCaptureError } from './media-capture.js';
import { FONT_ACCESS_DISABLE_FEATURE } from './fingerprint-settings.js';
import { chromiumPolicyArgs } from './webrtc-policy.js';
import { iceConsistencyFinding } from './webrtc-observe.js';

const STATUSES = new Set(['pass', 'warning', 'unsupported', 'unavailable']);
const HOST_PLATFORM = {
  linux: 'Linux x86_64',
  win32: 'Win32',
  darwin: 'MacIntel',
};

function finding(id, status, summary) {
  if (!STATUSES.has(status)) throw new Error(`bad consistency status ${status}`);
  return { id, status, summary };
}

function counts(findings) {
  const tally = { pass: 0, warning: 0, unsupported: 0, unavailable: 0 };
  for (const item of findings) tally[item.status] += 1;
  return tally;
}

function hasFlag(commandLine, flag) {
  return typeof commandLine === 'string' && commandLine.includes(flag);
}

export function fingerprintFindings({
  advanced = {},
  browserSettings = {},
  webrtc = { mode: 'browser_default' },
  observation = null,
  commandLine = null,
  chromiumVersion = null,
  hostPlatform = process.platform,
  hostTimezone = null,
  previous = null,
} = {}) {
  const fingerprint = advanced.fingerprint || {};
  const userAgent = advanced.userAgent || { mode: 'default' };
  const screen = advanced.screen || { preset: 'native' };
  const geo = advanced.geolocation || { permission: 'default' };
  const seen = observation && observation.availability === 'observed' ? observation : null;
  const findings = [];

  const hints = seen?.clientHints;
  if (!seen || !chromiumVersion) {
    findings.push(finding('ua_version', 'unavailable', seen ? 'The installed Chromium version was not available to compare.' : 'Launch the profile before comparing the user agent.'));
    findings.push(finding('ua_client_hints', 'unavailable', 'Client hints were not collected.'));
  } else if (!hints || hints.availability !== 'observed' || !hints.uaFullVersion) {
    findings.push(finding('ua_version', 'unavailable', 'The page did not expose a full client-hint version.'));
    findings.push(finding('ua_client_hints', 'unavailable', 'The page did not expose client hints.'));
  } else if (hints.uaFullVersion !== chromiumVersion || (hints.chromiumVersion && hints.chromiumVersion !== chromiumVersion)) {
    findings.push(finding('ua_version', 'warning', `Client hints report ${hints.uaFullVersion}, which is not the installed Chromium ${chromiumVersion}.`));
    findings.push(finding('ua_client_hints', 'warning', 'The client-hint version does not match the installed Chromium.'));
  } else if (userAgent.mode === 'reduced') {
    const major = `${chromiumVersion.split('.')[0]}.0.0.0`;
    const ua = seen.userAgent || '';
    const reduced = ua.includes(major) && !ua.includes(chromiumVersion);
    findings.push(finding('ua_version', reduced ? 'pass' : 'warning', reduced
      ? `The user agent uses ${major} and the client hint keeps the full version ${chromiumVersion}.`
      : 'Reduced mode did not produce a major-only user agent, or the full version leaked into that string.'));
    findings.push(finding('ua_client_hints', 'pass', `Client hints report the installed Chromium ${chromiumVersion}.`));
  } else if (userAgent.mode === 'full') {
    const ua = seen.userAgent || '';
    const full = ua.includes(chromiumVersion);
    findings.push(finding('ua_version', full ? 'pass' : 'warning', full
      ? `The user agent and client hints both carry ${chromiumVersion}.`
      : `Client hints carry ${chromiumVersion}, but the user agent string does not.`));
    findings.push(finding('ua_client_hints', 'pass', `Client hints report the installed Chromium ${chromiumVersion}.`));
  } else {
    findings.push(finding('ua_version', 'pass', `No user-agent override is configured. Client hints report the installed Chromium ${chromiumVersion}.`));
    findings.push(finding('ua_client_hints', 'pass', `Client hints report the installed Chromium ${chromiumVersion}. No other browser version was written.`));
  }

  const coherence = compareEngineIdentity({
    engineVersion: chromiumVersion,
    userAgent: seen?.userAgent || '',
    clientHints: hints?.availability === 'observed' ? hints : null,
  });
  if (!seen || !chromiumVersion || !seen.userAgent) {
    findings.push(finding('ua_engine_coherence', 'unavailable', 'The installed Chromium version and the page user agent were not both available.'));
  } else if (coherence.status === 'inconsistent') {
    findings.push(finding('ua_engine_coherence', 'warning', coherence.issues.join(' ')));
  } else if (coherence.status !== 'coherent') {
    findings.push(finding('ua_engine_coherence', 'unavailable', coherence.issues.join(' ') || 'The engine version could not be compared.'));
  } else {
    findings.push(finding('ua_engine_coherence', 'pass', `The user agent version is the installed Chromium ${chromiumVersion} or its reduced major. Client hints are not assigned a different version.`));
  }

  const hintPin = assessPinnedClientHints({ engineVersion: chromiumVersion, clientHints: hints, hostPlatform });
  if (hintPin.status === 'unavailable') findings.push(finding('ua_hint_pin', 'unavailable', hintPin.issues[0] || 'Client hints were not collected.'));
  else if (hintPin.status === 'inconsistent') findings.push(finding('ua_hint_pin', 'warning', hintPin.issues.join(' ')));
  else findings.push(finding('ua_hint_pin', 'pass', 'Client hint platform, mobile flag, and brands agree with this desktop Chromium when those fields were exposed. No other browser version was written.'));

  const expectedPlatform = HOST_PLATFORM[hostPlatform];
  if (!seen?.platform) findings.push(finding('host_platform', 'unavailable', 'navigator.platform was not collected.'));
  else if (!expectedPlatform) findings.push(finding('host_platform', 'unavailable', 'This operating system has no platform token to compare.'));
  else if (seen.platform === expectedPlatform) findings.push(finding('host_platform', 'pass', `navigator.platform is ${seen.platform}, which is this computer.`));
  else findings.push(finding('host_platform', 'warning', `navigator.platform is ${seen.platform}. This computer expects ${expectedPlatform}.`));

  findings.push(finding('navigator_custom', 'unsupported', 'hardwareConcurrency, deviceMemory, and OSCPU are not per-profile settings. Observed numbers are this computer’s, not a chosen device.'));

  const timezone = browserSettings.timezoneId || '';
  if (!seen?.timezone) findings.push(finding('timezone', 'unavailable', 'The page timezone was not collected.'));
  else if (timezone) findings.push(finding('timezone', seen.timezone === timezone ? 'pass' : 'warning', seen.timezone === timezone
    ? `The page timezone is the configured zone ${timezone}.`
    : `The page timezone is ${seen.timezone}. The profile is set to ${timezone}.`));
  else if (!hostTimezone) findings.push(finding('timezone', 'unavailable', 'No timezone is configured, and the computer timezone was not available to compare.'));
  else findings.push(finding('timezone', seen.timezone === hostTimezone ? 'pass' : 'warning', seen.timezone === hostTimezone
    ? `No timezone override is set. The page matches this computer (${hostTimezone}).`
    : `No timezone override is set, but the page reports ${seen.timezone} instead of this computer’s ${hostTimezone}.`));

  if (!timezone) findings.push(finding('timezone_offset', 'unavailable', 'No timezone is configured, so the offset is not graded.'));
  else if (!seen || typeof seen.timezoneOffset !== 'number') findings.push(finding('timezone_offset', 'unavailable', 'The page timezone offset was not collected.'));
  else {
    let expected = null;
    try { expected = timezoneOffsetMinutes(timezone); } catch { expected = null; }
    const match = expected != null && seen.timezoneOffset === expected;
    findings.push(finding('timezone_offset', match ? 'pass' : 'warning', match
      ? `The page offset is ${seen.timezoneOffset} minutes, which is the offset of ${timezone}.`
      : `The page offset is ${seen.timezoneOffset} minutes. ${timezone} is ${expected} minutes at this time.`));
  }

  const languages = Array.isArray(browserSettings.languages) ? browserSettings.languages : [];
  if (!seen?.languages) findings.push(finding('languages', 'unavailable', 'navigator.languages was not collected.'));
  else if (!languages.length) findings.push(finding('languages', 'unavailable', 'No language list is configured, so there is no expected order to compare.'));
  else {
    const judged = assessLanguageList(languages, seen.languages);
    const status = judged.status === 'fail' ? 'warning' : judged.status;
    findings.push(finding('languages', status, judged.status === 'pass'
      ? `navigator.languages matches the configured list (${languages.join(', ')}).`
      : judged.issues[0]));
  }

  const locale = browserSettings.locale || '';
  if (!seen?.locale) findings.push(finding('locale', 'unavailable', 'navigator.language was not collected.'));
  else if (!locale) findings.push(finding('locale', 'unavailable', 'No locale is configured, so the host value is not graded.'));
  else findings.push(finding('locale', seen.locale === locale ? 'pass' : 'warning', seen.locale === locale
    ? `navigator.language is the configured locale ${locale}.`
    : `navigator.language is ${seen.locale}. The profile locale is ${locale}.`));

  if (!locale) findings.push(finding('intl_locale', 'unavailable', 'No locale is configured, so the Intl locale is not graded.'));
  else if (!seen?.intlLocale) findings.push(finding('intl_locale', 'unavailable', 'The Intl locale was not collected.'));
  else findings.push(finding('intl_locale', seen.intlLocale === locale ? 'pass' : 'warning', seen.intlLocale === locale
    ? `Intl locale is the configured locale ${locale}.`
    : `Intl locale is ${seen.intlLocale}. The profile locale is ${locale}.`));

  const configuredScreen = screen.preset && screen.preset !== 'native';
  const expectScale = screen.deviceScaleFactor != null;
  if (!seen?.screen) findings.push(finding('screen', 'unavailable', 'Screen and viewport were not collected.'));
  else if (!configuredScreen && !expectScale) findings.push(finding('screen', 'unavailable', 'No screen size or scale is configured, so the host display is not graded.'));
  else {
    const mismatches = [];
    if (screen.viewportWidth != null && seen.screen.innerWidth !== screen.viewportWidth) mismatches.push('viewport width');
    if (screen.viewportHeight != null && seen.screen.innerHeight !== screen.viewportHeight) mismatches.push('viewport height');
    if (screen.width != null && seen.screen.width !== screen.width) mismatches.push('screen width');
    if (screen.height != null && seen.screen.height !== screen.height) mismatches.push('screen height');
    if (expectScale && seen.screen.devicePixelRatio !== screen.deviceScaleFactor) mismatches.push('device scale');
    findings.push(finding('screen', mismatches.length ? 'warning' : 'pass', mismatches.length
      ? `The page does not match the configured ${mismatches.join(', ')}.`
      : 'Viewport, screen, and device scale match the configured values.'));
  }
  findings.push(finding('screen_monitor', 'unsupported', 'Window size, viewport, and device scale can be set. The screen API is not replaced with another monitor layout. A window fully outside known displays is moved to the primary origin only when those displays were supplied.'));

  if (geo.permission === 'default') findings.push(finding('geolocation', 'unavailable', 'Geolocation is left to the browser prompt. No allow or deny result is claimed.'));
  else if (!seen?.permissions?.geolocation || seen.permissions.geolocation.availability !== 'observed') findings.push(finding('geolocation', 'unavailable', 'The geolocation permission was not collected.'));
  else if (geo.permission === 'deny' || geo.permission === 'ask') {
    const expected = geo.permission === 'deny' ? 'denied' : 'prompt';
    findings.push(finding('geolocation', seen.permissions.geolocation.state === expected ? 'pass' : 'warning', seen.permissions.geolocation.state === expected
      ? `Geolocation permission is ${expected}, as configured.`
      : `Geolocation permission is ${seen.permissions.geolocation.state}. The profile asked for ${expected}.`));
  } else if (geo.permission === 'allow' && geo.latitude != null) {
    const position = seen.geolocation;
    const close = position && Math.abs(position.latitude - geo.latitude) < 0.000001 && Math.abs(position.longitude - geo.longitude) < 0.000001;
    findings.push(finding('geolocation', close ? 'pass' : 'warning', close
      ? 'The page received the coordinates saved on this profile.'
      : 'Geolocation is Allow, but the page did not return the saved coordinates.'));
  }   else findings.push(finding('geolocation', 'unavailable', 'Geolocation is Allow without coordinates, so no position was expected.'));
  findings.push(finding('geolocation_scope', 'unsupported', 'Geolocation permission and coordinates apply inside this browser profile. They do not conceal GPS, Wi-Fi, or IP location from the operating system or the network. Native launch stores the permission and does not apply a Playwright coordinate override.'));
  findings.push(finding('geolocation_native', 'unsupported', 'Coordinate override on native Chromium spawn is BLOCKED_SPAWN: pinned CfT has no command-line equivalent to CDP Emulation.setGeolocationOverride.'));

  const policyFlag = chromiumPolicyArgs(webrtc)[0] || null;
  if (typeof commandLine !== 'string' || !commandLine.trim()) findings.push(finding('webrtc_flag', 'unavailable', 'The browser command line was not available, so the WebRTC policy was not checked.'));
  else if (!policyFlag) findings.push(finding('webrtc_flag', commandLine.includes('--force-webrtc-ip-handling-policy=') ? 'warning' : 'pass', commandLine.includes('--force-webrtc-ip-handling-policy=')
    ? 'A WebRTC policy flag is present even though this profile did not set one.'
    : 'No WebRTC policy flag is present. This is Chromium’s own behavior, not a proxy-matched address.'));
  else findings.push(finding('webrtc_flag', commandLine.includes(policyFlag) ? 'pass' : 'warning', commandLine.includes(policyFlag)
    ? `The process has ${policyFlag}. That restricts candidate paths. It does not copy the proxy IP into WebRTC.`
    : `The saved WebRTC policy ${policyFlag} is not on the process command line.`));
  findings.push(finding('webrtc_proxy_match', 'unsupported', 'WebRTC addresses are never compared to the proxy exit IP. ICE is summarized by candidate type only.'));
  const iceFinding = iceConsistencyFinding(webrtc.mode || 'browser_default', seen?.webrtcIce);
  findings.push(finding(iceFinding.id, iceFinding.status, iceFinding.summary));

  if (fingerprint.webgl === 'restricted') {
    if (!seen || typeof commandLine !== 'string') findings.push(finding('webgl_restriction', 'unavailable', 'WebGL restriction needs both a running page and the process command line.'));
    else if (!hasFlag(commandLine, WEBGL_DISABLE_ARG)) findings.push(finding('webgl_restriction', 'warning', '--disable-webgl is not on the process command line.'));
    else if (seen.webgl?.availability === 'unavailable') findings.push(finding('webgl_restriction', 'pass', 'WebGL is off: --disable-webgl is on the process and the page has no WebGL context. No replacement renderer was applied.'));
    else findings.push(finding('webgl_restriction', 'warning', 'WebGL still created a context even though --disable-webgl is on the process.'));
  } else findings.push(finding('webgl_restriction', 'unavailable', 'WebGL is Default. Nothing is being turned off, and the renderer is not being replaced.'));

  if (seen?.webgl?.availability === 'observed') findings.push(finding('webgl_metadata', 'unsupported', `WebGL reports ${seen.webgl.vendor || 'an empty vendor'} / ${seen.webgl.renderer || 'an empty renderer'}. Those are the machine’s strings. This app cannot substitute another GPU.`));
  else findings.push(finding('webgl_metadata', 'unsupported', 'WebGL vendor and renderer are not replaced. No alternate GPU string is stored.'));

  const gpu = seen?.webgpu;
  if (gpu?.availability === 'observed') findings.push(finding('webgpu_metadata', 'unsupported', `WebGPU adapter info was visible (vendor ${gpu.vendor || 'empty'}, device ${gpu.device || 'empty'}). It is not replaced.`));
  else if (gpu?.apiPresent) findings.push(finding('webgpu_metadata', 'unsupported', `navigator.gpu is present and the adapter is ${gpu.reason || 'unavailable'}. No vendor or device id is invented, and a disable switch is not offered because it did not remove the API in testing.`));
  else findings.push(finding('webgpu_metadata', 'unsupported', 'WebGPU metadata is not replaced. The API was not available to read, so no adapter values are filled in.'));

  findings.push(finding('canvas_noise', 'unsupported', 'Canvas noise is not applied. Stock Chromium has no persistent canvas-noise control.'));
  if (seen?.canvas?.sha256) findings.push(finding('canvas_readback', 'pass', `Canvas mode is real. SHA-256 ${seen.canvas.sha256} is this browser’s own readback, not a stored mask.`));
  else findings.push(finding('canvas_readback', 'unavailable', 'A canvas readback was not collected.'));

  findings.push(finding('audio_noise', 'unsupported', 'AudioContext noise is not applied. Stock Chromium has no persistent audio-noise control.'));
  if (seen?.audio?.sha256) findings.push(finding('audio_readback', 'pass', `Audio mode is real. SHA-256 ${seen.audio.sha256} is this browser’s own render at ${seen.audio.sampleRate} Hz.`));
  else findings.push(finding('audio_readback', 'unavailable', 'An AudioContext render was not collected.'));

  findings.push(finding('fonts_mask', 'unsupported', 'The installed font list is not replaced. Canvas font measurement still sees this computer. Restricted only denies the local-fonts permission.'));
  if (fingerprint.fonts !== 'restricted') findings.push(finding('fonts_permission', 'unavailable', 'Local font access is not restricted on this profile.'));
  else if (seen?.permissions?.['local-fonts']?.availability !== 'observed') findings.push(finding('fonts_permission', 'unavailable', 'The local-fonts permission was not collected.'));
  else findings.push(finding('fonts_permission', seen.permissions['local-fonts'].state === 'denied' ? 'pass' : 'warning', seen.permissions['local-fonts'].state === 'denied'
    ? 'The local-fonts permission is denied. Font measurement through canvas is still possible.'
    : `The local-fonts permission is ${seen.permissions['local-fonts'].state}, not denied.`));
  if (fingerprint.fonts !== 'restricted') findings.push(finding('fonts_query_api', 'unavailable', 'Local font access is not restricted on this profile.'));
  else if (!seen?.fontsQuery) findings.push(finding('fonts_query_api', 'unavailable', 'queryLocalFonts was not collected.'));
  else if (seen.fontsQuery.apiPresent === false) {
    findings.push(finding('fonts_query_api', 'pass', `queryLocalFonts is unavailable because ${FONT_ACCESS_DISABLE_FEATURE} is disabled for this profile. Canvas measureText is not blocked.`));
  } else if (seen.fontsQuery.resolved) {
    findings.push(finding('fonts_query_api', 'warning', 'queryLocalFonts resolved even though fonts are Restricted. FontAccess disable may be missing from the process.'));
  } else findings.push(finding('fonts_query_api', 'pass', `queryLocalFonts did not resolve (${seen.fontsQuery.errorName || 'rejected'}). Canvas measureText is not blocked.`));

  findings.push(finding('media_mask', 'unsupported', 'Cameras and microphones are not replaced with generated devices.'));
  if (fingerprint.mediaDevices !== 'restricted') findings.push(finding('media_permission', 'unavailable', 'Media devices are Real. Camera and microphone follow their own permission settings.'));
  else if (seen?.permissions?.camera?.availability !== 'observed' || seen?.permissions?.microphone?.availability !== 'observed') findings.push(finding('media_permission', 'unavailable', 'Camera or microphone permission was not collected.'));
  else {
    const denied = seen.permissions.camera.state === 'denied' && seen.permissions.microphone.state === 'denied';
    findings.push(finding('media_permission', denied ? 'pass' : 'warning', denied
      ? 'Camera and microphone are denied. The device list is still this computer’s list.'
      : `Camera is ${seen.permissions.camera.state} and microphone is ${seen.permissions.microphone.state}. Restricted expected both to be denied.`));
  }
  if (fingerprint.mediaDevices !== 'restricted') findings.push(finding('media_capture', 'unavailable', 'Media devices are Real. No capture classification is graded.'));
  else if (seen?.mediaCapture?.availability !== 'observed') findings.push(finding('media_capture', 'unavailable', 'getUserMedia was not exercised.'));
  else {
    const classified = classifyMediaCaptureError(seen.mediaCapture.errorName, {
      cameraState: seen.permissions?.camera?.state,
      microphoneState: seen.permissions?.microphone?.state,
    });
    const ok = classified.kind === 'permission_denied' || classified.kind === 'no_device';
    findings.push(finding('media_capture', ok ? 'pass' : 'warning', `${classified.summary} (error ${classified.errorName}).`));
  }
  if (fingerprint.mediaDevices !== 'restricted') findings.push(finding('media_enumeration', 'unavailable', 'Media devices are Real. Enumeration is not graded.'));
  else if (seen?.media?.devices?.availability !== 'observed') findings.push(finding('media_enumeration', 'unavailable', 'Media device enumeration was not collected.'));
  else if (seen.media.devices.labelsAvailable) findings.push(finding('media_enumeration', 'warning', 'Device labels are visible while media devices are Restricted. Restricted does not invent a device list.'));
  else findings.push(finding('media_enumeration', 'pass', `Enumeration returned ${seen.media.devices.count} device(s) and no labels. This is still this computer’s list, not a substitute list.`));

  findings.push(finding('port_scan_mask', 'unsupported', 'Port-scan results are not masked, and there is no whitelist of local ports.'));
  const network = privateNetworkWeakening(commandLine);
  if (network.availability !== 'observed') findings.push(finding('port_scan_policy', 'unavailable', 'The process command line was not available, so private-network features were not checked.'));
  else if (network.features.length) findings.push(finding('port_scan_policy', 'warning', `The process disables ${network.features.join(', ')}. This app does not add those switches itself.`));
  else findings.push(finding('port_scan_policy', 'pass', 'The process command line does not disable Chromium’s private-network checks. That is not proof that every local port probe fails, and no masked result is substituted.'));
  if (fingerprint.portScan !== 'real') findings.push(finding('local_network_access', 'unavailable', 'Port scan is not in the default real mode.'));
  else if (seen?.permissions?.['local-network-access']?.availability !== 'observed') {
    findings.push(finding('local_network_access', 'unavailable', 'The local-network-access permission was not collected.'));
  } else findings.push(finding('local_network_access', seen.permissions['local-network-access'].state === 'denied' ? 'pass' : 'warning', seen.permissions['local-network-access'].state === 'denied'
    ? 'local-network-access is denied through profile preferences (local_network_access). Private-network weakening flags are still refused on launch.'
    : `local-network-access is ${seen.permissions['local-network-access'].state}, not denied.`));

  const restart = (id, key, label) => {
    if (!previous || previous[key] == null || previous[key] === '') return finding(id, 'unavailable', `No previous ${label} was supplied.`);
    if (!seen) return finding(id, 'unavailable', `The profile is not running, so ${label} cannot be compared.`);
    const current = key === 'webglRenderer' ? seen.webgl?.renderer : key === 'canvasSha256' ? seen.canvas?.sha256 : seen.audio?.sha256;
    if (!current) return finding(id, 'unavailable', `The current ${label} was not collected.`);
    return finding(id, current === previous[key] ? 'pass' : 'warning', current === previous[key]
      ? `${label} matches the previous observation from this profile.`
      : `${label} changed since the previous observation.`);
  };
  findings.push(restart('restart_canvas', 'canvasSha256', 'canvas readback'));
  findings.push(restart('restart_audio', 'audioSha256', 'audio render'));
  findings.push(restart('restart_webgl', 'webglRenderer', 'WebGL renderer'));
  if (!previous || previous.fingerprintSettings == null || previous.fingerprintSettings === '') {
    findings.push(finding('restart_fingerprint', 'unavailable', 'No previous fingerprint settings were supplied.'));
  } else if (!fingerprint || !Object.keys(fingerprint).length) {
    findings.push(finding('restart_fingerprint', 'unavailable', 'This profile has no fingerprint settings to compare.'));
  } else {
    const current = JSON.stringify(fingerprint);
    findings.push(finding('restart_fingerprint', current === previous.fingerprintSettings ? 'pass' : 'warning', current === previous.fingerprintSettings
      ? 'Fingerprint settings match the previous observation.'
      : 'Fingerprint settings changed since the previous observation.'));
  }

  return { findings, counts: counts(findings) };
}

const PREVIOUS_KEYS = new Set(['canvasSha256', 'audioSha256', 'webglRenderer', 'fingerprintSettings']);

export function readPreviousObservation(body) {
  if (!body || body.previous == null) return null;
  const previous = body.previous;
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) {
    throw Object.assign(new Error('previous must be an object'), { status: 400, code: 'INVALID_FINGERPRINT_COMPARISON' });
  }
  for (const key of Object.keys(previous)) {
    if (!PREVIOUS_KEYS.has(key)) {
      throw Object.assign(new Error('previous may only include canvasSha256, audioSha256, and webglRenderer'), { status: 400, code: 'INVALID_FINGERPRINT_COMPARISON' });
    }
    const max = key === 'fingerprintSettings' ? 2000 : 300;
    if (previous[key] != null && (typeof previous[key] !== 'string' || previous[key].length > max)) {
      throw Object.assign(new Error(`${key} must be a short string`), { status: 400, code: 'INVALID_FINGERPRINT_COMPARISON' });
    }
  }
  return {
    canvasSha256: previous.canvasSha256 || null,
    audioSha256: previous.audioSha256 || null,
    webglRenderer: previous.webglRenderer || null,
    fingerprintSettings: previous.fingerprintSettings || null,
  };
}
