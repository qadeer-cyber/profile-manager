// Per-profile Device Identity (Phase 2).
//
// A stock Chrome, Chromium or Firefox profile can only present the computer it runs on: its real
// OS, platform, fonts, GPU and input devices. A preset is therefore a declared identity that this
// app *verifies* against the live browser, never a spoof. Presets for another OS or a mobile device
// stay visible but are refused, because the engine on this host cannot present them coherently.
//
// This module is pure (no node:os import) so the editor can share the preset list; the server
// passes the observed host description in.

export const DEVICE_PRESETS = Object.freeze([
  { id: 'host', label: 'Match this computer', family: 'desktop', os: null },
  { id: 'windows-11', label: 'Windows 11 desktop', family: 'desktop', os: 'windows', osVersion: '11' },
  { id: 'windows-10', label: 'Windows 10 desktop', family: 'desktop', os: 'windows', osVersion: '10' },
  { id: 'macos-imac', label: 'macOS iMac', family: 'desktop', os: 'macos' },
  { id: 'macos-macbook', label: 'macOS MacBook', family: 'desktop', os: 'macos' },
  { id: 'linux-desktop', label: 'Linux desktop', family: 'desktop', os: 'linux' },
  { id: 'android-phone', label: 'Android phone', family: 'mobile', os: 'android' },
  { id: 'android-tablet', label: 'Android tablet', family: 'mobile', os: 'android' },
  { id: 'iphone', label: 'iPhone', family: 'mobile', os: 'ios' },
  { id: 'ipad', label: 'iPad', family: 'mobile', os: 'ios' },
].map(Object.freeze));

export const DEFAULT_DEVICE_IDENTITY = Object.freeze({ preset: 'host' });
const OS_NAMES = { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS' };
const MOBILE_REASON = {
  android: 'Requires a real Android device and a mobile browser engine. Desktop Chrome with a phone-sized window and a borrowed user agent is still desktop Chrome (its GPU, fonts and platform contradict the claim), so it is not offered.',
  ios: 'iPhone and iPad browsers use Apple WebKit. Chrome, Chromium and Firefox on this computer cannot present WebKit, so this is not offered.',
};

export const presetById = id => DEVICE_PRESETS.find(preset => preset.id === id) || null;

// Host description from the OS: { os: 'windows'|'macos'|'linux', osVersion?: '10'|'11', release }.
// Windows 11 still reports kernel 10.0; build 22000 and later is Windows 11.
export function describeHost(platform, release = '') {
  if (platform === 'win32') {
    const build = Number(String(release).split('.')[2]);
    return { os: 'windows', osVersion: Number.isFinite(build) ? (build >= 22000 ? '11' : '10') : null, release: String(release) };
  }
  if (platform === 'darwin') return { os: 'macos', osVersion: null, release: String(release) };
  if (platform === 'linux') return { os: 'linux', osVersion: null, release: String(release) };
  return { os: null, osVersion: null, release: String(release) };
}

export function hostLabel(host) {
  if (!host?.os) return 'This computer';
  return [OS_NAMES[host.os], host.osVersion].filter(Boolean).join(' ');
}

// Can this host present the preset with its own real engine? Returns { state, reason }.
export function presetSupport(presetId, host) {
  const preset = presetById(presetId);
  if (!preset) return { state: 'unsupported', reason: 'Unknown device preset.' };
  if (preset.id === 'host') return { state: 'supported', reason: `Uses this computer's real identity (${hostLabel(host)}).` };
  if (preset.family === 'mobile') return { state: 'unsupported', reason: MOBILE_REASON[preset.os] };
  if (!host?.os) return { state: 'unsupported', reason: 'This computer’s operating system could not be identified.' };
  if (preset.os !== host.os) {
    return { state: 'unsupported', reason: `Requires a ${OS_NAMES[preset.os]} computer. A browser on ${hostLabel(host)} exposes its own platform, fonts and GPU, so it cannot present ${preset.label} coherently.` };
  }
  if (preset.osVersion && host.osVersion && preset.osVersion !== host.osVersion) {
    return { state: 'unsupported', reason: `This computer runs ${hostLabel(host)}. Chrome reports the real Windows version through client hints, so ${preset.label} would contradict it.` };
  }
  if (preset.osVersion && !host.osVersion) return { state: 'unsupported', reason: 'The Windows version of this computer could not be determined.' };
  return { state: 'supported', reason: `Matches this computer (${hostLabel(host)}).` };
}

export function presetMatrix(host) {
  return DEVICE_PRESETS.map(preset => ({ ...preset, ...presetSupport(preset.id, host) }));
}

const invalid = message => { throw Object.assign(new Error(message), { status: 400, code: 'INVALID_ADVANCED_SETTINGS', tab: 'fingerprint' }); };

// Shape check, shared with the editor. Host support is checked separately on the server.
export function validateDeviceIdentity(value) {
  if (value == null) return { ...DEFAULT_DEVICE_IDENTITY };
  if (typeof value !== 'object' || Array.isArray(value)) invalid('deviceIdentity must be an object');
  if (Object.keys(value).some(key => key !== 'preset')) invalid('Unknown deviceIdentity field');
  if (!presetById(value.preset)) invalid('Unknown device preset');
  return { preset: value.preset };
}

// Server-side save gate: a preset this host cannot present is refused rather than stored.
export function assertDevicePresetSupported(deviceIdentity, host) {
  const support = presetSupport(deviceIdentity?.preset || 'host', host);
  if (support.state !== 'supported') invalid(support.reason);
}

// Expected browser-visible values for a preset on this host (used by verification).
const CH_PLATFORM = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };
const NAV_PLATFORM = { windows: /^Win32$/, macos: /^MacIntel$/, linux: /^Linux/ };

// Compare the declared preset with what the running browser exposed. Never "pass" without an observation.
export function deviceIdentityFinding(deviceIdentity, host, seen) {
  const presetId = deviceIdentity?.preset || 'host';
  const preset = presetById(presetId);
  const support = presetSupport(presetId, host);
  if (support.state !== 'supported') {
    return { status: 'warning', summary: `Saved preset ${preset?.label || presetId} cannot be presented here: ${support.reason}` };
  }
  if (!seen) return { status: 'unavailable', summary: 'Launch the profile to compare the device identity with the browser.' };
  const os = preset.os || host.os;
  const issues = [];
  if (NAV_PLATFORM[os] && seen.platform && !NAV_PLATFORM[os].test(seen.platform)) issues.push(`navigator.platform is ${seen.platform}`);
  const ch = seen.clientHints?.availability === 'observed' ? seen.clientHints : null;
  if (ch?.platform && CH_PLATFORM[os] && ch.platform !== CH_PLATFORM[os]) issues.push(`client-hint platform is ${ch.platform}`);
  if (ch?.mobile === true) issues.push('client hints mark a mobile device');
  const wantVersion = preset.osVersion || (os === 'windows' ? host.osVersion : null);
  if (os === 'windows' && wantVersion && ch?.platformVersion) {
    const major = Number(String(ch.platformVersion).split('.')[0]);
    const observed = major >= 13 ? '11' : major >= 1 ? '10' : null;
    if (observed && observed !== wantVersion) issues.push(`client-hint platformVersion ${ch.platformVersion} means Windows ${observed}`);
  }
  if (issues.length) return { status: 'warning', summary: `${preset.label} does not match the browser: ${issues.join('; ')}.` };
  const checked = [seen.platform && 'navigator.platform', ch?.platform && 'client-hint platform', ch?.platformVersion && os === 'windows' && 'platformVersion', ch && 'mobile flag'].filter(Boolean);
  if (!checked.length) return { status: 'unavailable', summary: 'The browser did not expose platform values to compare.' };
  return { status: 'pass', summary: `${preset.label}: ${checked.join(', ')} match ${hostLabel(host)}.` };
}
