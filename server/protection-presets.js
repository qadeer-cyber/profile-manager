// Protection presets for AZWAH Chromium profiles. A preset is only a named combination of the three stored switches
// (experimental.canvasReadback, .hardwareIdentity, .audioReadback); nothing new is saved, so profiles, backups and the
// launcher are unchanged. `features` says which protections the installed browser build actually contains
// (azwahNativeFeatures); a preset never enables one the build lacks, because the launcher refuses such a profile.

export const PROTECTION_FLAGS = Object.freeze([
  { key: 'canvasReadback', feature: 'canvas', label: 'Canvas protection' },
  { key: 'hardwareIdentity', feature: 'identity', label: 'Hardware and graphics identity' },
  { key: 'audioReadback', feature: 'audioScreen', label: 'Audio protection' },
]);

const supportedFlags = features => PROTECTION_FLAGS.filter(f => !features || features[f.feature]);

// Settings for a preset: 'off' clears every switch; 'standard' turns on every protection the build has.
export function presetSettings(preset, features = null) {
  const on = preset === 'standard' ? new Set(supportedFlags(features).map(f => f.key)) : new Set();
  return Object.fromEntries(PROTECTION_FLAGS.map(f => [f.key, on.has(f.key) ? 'prototype' : 'off']));
}

// Which preset the saved switches amount to. 'unavailable' = this build has none of the protections.
export function presetOf(experimental, features = null) {
  const usable = supportedFlags(features);
  if (!usable.length) return 'unavailable';
  const enabled = usable.filter(f => experimental?.[f.key] === 'prototype').length;
  const stray = PROTECTION_FLAGS.some(f => !usable.includes(f) && experimental?.[f.key] === 'prototype');
  if (!enabled && !stray) return 'off';
  if (enabled === usable.length && !stray) return 'standard';
  return 'custom';
}

export const PRESET_TEXT = Object.freeze({
  off: 'Off: this profile shows this computer’s real canvas, audio, graphics and hardware values.',
  standard: 'Standard: canvas and audio readbacks are slightly changed per site, and the profile reports its own CPU, memory, graphics, screen, fonts and client hints.',
  custom: 'Custom: a mix of switches below.',
  unavailable: 'This browser build has no protections to switch on.',
});
