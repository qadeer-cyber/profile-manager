// Protection presets for AZWAH Chromium profiles. A preset is a named combination of the stored switches
// (experimental.canvasReadback, .hardwareIdentity, .audioReadback and, for Strict, .strict); nothing else is saved, so
// profiles, backups and the launcher stay compatible. `features` says which protections the installed browser build
// contains (azwahNativeFeatures); Standard never enables one the build lacks, because the launcher refuses such a profile.
//
//   Off       every protection off
//   Standard  every protection the build contains (a missing one is left off)
//   Strict    Standard, plus fail-closed launch rules: the profile will not open unless a proxy is assigned, the build
//             contains every protection, and the assigned proxy has not failed its last test. It protects the same
//             surfaces as Standard; what it adds is a refusal to run with less than the full set.

export const PROTECTION_FLAGS = Object.freeze([
  { key: 'canvasReadback', feature: 'canvas', label: 'Canvas protection' },
  { key: 'hardwareIdentity', feature: 'identity', label: 'Hardware and graphics identity' },
  { key: 'audioReadback', feature: 'audioScreen', label: 'Audio protection' },
]);

// Everything Strict insists on in the browser build (each is a patch recorded in the build manifest).
export const STRICT_FEATURES = Object.freeze([
  { feature: 'canvas', label: 'canvas protection' },
  { feature: 'identity', label: 'hardware and graphics identity' },
  { feature: 'audioScreen', label: 'audio and screen protection' },
  { feature: 'gpuFonts', label: 'fonts and WebGPU identity' },
  { feature: 'rectsUa', label: 'ClientRects and client hints' },
  { feature: 'mediaWebrtc', label: 'media devices and WebRTC address' },
]);

const supportedFlags = features => PROTECTION_FLAGS.filter(f => !features || features[f.feature]);

export function strictAvailability(features) {
  const missing = STRICT_FEATURES.filter(f => !features?.[f.feature]).map(f => f.label);
  return { available: missing.length === 0, missing };
}

// Settings for a preset. Every preset sets `strict` explicitly, so switching away from Strict clears it.
export function presetSettings(preset, features = null) {
  const wantStrict = preset === 'strict' && strictAvailability(features).available;
  const on = preset === 'standard' || preset === 'strict' ? new Set(supportedFlags(features).map(f => f.key)) : new Set();
  return { ...Object.fromEntries(PROTECTION_FLAGS.map(f => [f.key, on.has(f.key) ? 'prototype' : 'off'])), strict: wantStrict ? 'on' : 'off' };
}

// Which preset the saved switches amount to. 'unavailable' = this build has none of the protections.
export function presetOf(experimental, features = null) {
  const usable = supportedFlags(features);
  if (!usable.length) return 'unavailable';
  const enabled = usable.filter(f => experimental?.[f.key] === 'prototype').length;
  const stray = PROTECTION_FLAGS.some(f => !usable.includes(f) && experimental?.[f.key] === 'prototype');
  const strict = experimental?.strict === 'on';
  if (!enabled && !stray && !strict) return 'off';
  if (enabled === usable.length && !stray) return strict ? 'strict' : 'standard';
  return 'custom';
}

// Rules Strict enforces at launch. Returns every failure so the user can fix them together; [] means it may launch.
// `profile` is the saved profile (advancedSettings, proxy with its stored lastTest); `features` the build's features.
export function strictPreconditions({ profile, features } = {}) {
  const failures = [];
  const experimental = profile?.advancedSettings?.experimental || {};
  if (experimental.strict !== 'on') return failures;
  if (profile?.advancedSettings?.runtime !== 'azwah-native') {
    failures.push({ code: 'STRICT_REQUIRES_AZWAH_CHROMIUM', message: 'Strict protection runs only on AZWAH Chromium.' });
  }
  if (!profile?.proxy && !profile?.proxyId) {
    failures.push({ code: 'STRICT_REQUIRES_PROXY', message: 'Strict protection needs a proxy: without one, websites would see this computer’s own IP address.' });
  }
  const build = strictAvailability(features);
  if (!build.available) {
    failures.push({ code: 'STRICT_BUILD_INCOMPLETE', message: `This browser build lacks: ${build.missing.join(', ')}. Update AZWAH or use Standard.` });
  }
  const switchedOff = PROTECTION_FLAGS.filter(f => experimental[f.key] !== 'prototype').map(f => f.label.toLowerCase());
  if (switchedOff.length) {
    failures.push({ code: 'STRICT_PROTECTIONS_OFF', message: `Strict needs every protection on, but ${switchedOff.join(', ')} ${switchedOff.length === 1 ? 'is' : 'are'} off.` });
  }
  if (profile?.proxy?.lastTest?.status === 'failed') {
    failures.push({ code: 'STRICT_PROXY_FAILED', message: 'The assigned proxy failed its last test. Test it again or assign another proxy.' });
  }
  return failures;
}

export const PRESET_TEXT = Object.freeze({
  off: 'Off: this profile shows this computer’s real canvas, audio, graphics and hardware values.',
  standard: 'Standard: canvas and audio readbacks are slightly changed per site, and the profile reports its own CPU, memory, graphics, screen, fonts and client hints.',
  strict: 'Strict: Standard, and the profile will not open unless a proxy is assigned, this browser build has every protection, and the proxy has not failed its last test.',
  custom: 'Custom: a mix of switches below.',
  unavailable: 'This browser build has no protections to switch on.',
});
