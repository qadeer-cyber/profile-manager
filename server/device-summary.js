// "Which device is this MAC?" Pairs a profile's saved MAC label with the device the profile presents, so a MAC seen in
// the app, a spreadsheet or a router log can be tied to a profile and a device. The MAC is a saved label only (websites
// cannot read it and AZWAH never changes an adapter); the device shown is what this profile REPORTS, not new hardware.
import { createHash } from 'node:crypto';
import { nativeIdentityFor } from './browser-runtime/native-identity.js';
import { presetById } from './device-identity.js';

// "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)" -> "Intel UHD Graphics 620"
export function gpuDisplayName(renderer) {
  const inner = /^ANGLE \([^,]*,\s*(.*?)\s+Direct3D11\b/.exec(String(renderer || ''))?.[1] || String(renderer || '');
  return inner.replace(/\((?:R|TM)\)/g, '').replace(/\s+/g, ' ').trim();
}
// Client-hint Windows platform versions: 10.0.0 is Windows 10; 13.0.0 and later are Windows 11 releases.
export const windowsName = platformVersion => (Number.parseInt(String(platformVersion).split('.')[0], 10) >= 13 ? 'Windows 11' : 'Windows 10');

export const deviceCode = mac => 'DEV-' + createHash('sha256').update('azwah-device-code\n' + String(mac || '').toUpperCase()).digest('hex').slice(0, 6).toUpperCase();

// `profile` is a row2p profile (advancedSettings, id, macLabel). Pure apart from hashing.
export function deviceSummaryFor(profile) {
  const advanced = profile?.advancedSettings || {};
  const experimental = advanced.experimental || {};
  const name = String(advanced.deviceName || '').trim();
  const mac = profile?.macLabel || '';
  let reportsAs, source, facts = null;
  if (advanced.runtime === 'azwah-native' && experimental.hardwareIdentity === 'prototype') {
    const id = nativeIdentityFor(profile.id, Number.isInteger(experimental.seedEpoch) ? experimental.seedEpoch : 0);
    facts = { os: windowsName(id.platformVersion), gpu: gpuDisplayName(id.webglRenderer), cores: id.hardwareConcurrency, memoryGiB: id.deviceMemory, screen: id.screen };
    reportsAs = `${facts.os} PC · ${facts.gpu} · ${facts.cores} cores · ${facts.memoryGiB} GB · ${facts.screen.replace('x', '×')}`;
    source = 'profile';
  } else if (advanced.deviceIdentity?.preset && advanced.deviceIdentity.preset !== 'host') {
    reportsAs = (presetById(advanced.deviceIdentity.preset)?.label || 'Declared device') + ' (declared; checked against the live browser)';
    source = 'declared';
  } else {
    reportsAs = 'This computer (real hardware)';
    source = 'host';
  }
  return { name: name || null, mac, code: deviceCode(mac), reportsAs, source, facts,
    label: [name, reportsAs].filter(Boolean).join(' · ') };
}
