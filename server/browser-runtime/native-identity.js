// Per-profile hardware and graphics identity for AZWAH Chromium (identity.patch). Values are realistic for a Windows
// desktop and derived from the profile id, so a profile keeps the same identity on every launch while different
// profiles differ. Only Windows desktop GPUs (Direct3D 11 through ANGLE, as Chrome on Windows reports them) are used,
// because the browser really runs on Windows.
import { createHash } from 'node:crypto';

export const WINDOWS_GPUS = Object.freeze([
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'turing'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)', 'turing'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ampere'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'turing'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'gen-9'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'gen-12lp'],
  ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)', 'gcn-4'],
].map(Object.freeze));
const CORES = Object.freeze([4, 6, 8, 8, 12, 16]);
// Common Windows desktop monitors (the battery is reported as a desktop's, so no laptop-only sizes).
const SCREENS = Object.freeze(['1920x1080', '1920x1080', '1920x1080', '2560x1440', '1680x1050', '1600x900', '1920x1200']);
// navigator.deviceMemory is capped at 8 by Chrome; desktops with 6+ cores report 8, 4-core machines 4 or 8.
const memoryFor = (cores, byte) => (cores >= 6 ? 8 : [4, 8][byte % 2]);
// Windows speech voices (lower case, as the browser compares them). Each profile offers its own non-empty subset.
export const WINDOWS_VOICES = Object.freeze(['microsoft david - english (united states)', 'microsoft zira - english (united states)',
  'microsoft mark - english (united states)']);
// Client-hint Windows platform versions (10.0.0 is Windows 10; 13.0.0 and later are Windows 11 releases).
const PLATFORM_VERSIONS = Object.freeze(['10.0.0', '15.0.0', '19.0.0']);
// Fonts of a standard Windows 10/11 installation, plus common optional fonts (Office and others) of which each profile
// shows its own subset. Lower case, as the browser compares them.
export const WINDOWS_BASE_FONTS = Object.freeze(['arial', 'arial black', 'bahnschrift', 'calibri', 'cambria', 'cambria math',
  'candara', 'comic sans ms', 'consolas', 'constantia', 'corbel', 'courier new', 'ebrima', 'franklin gothic medium', 'gabriola',
  'gadugi', 'georgia', 'impact', 'ink free', 'javanese text', 'leelawadee ui', 'lucida console', 'lucida sans unicode',
  'malgun gothic', 'marlett', 'microsoft himalaya', 'microsoft jhenghei', 'microsoft new tai lue', 'microsoft phagspa',
  'microsoft sans serif', 'microsoft tai le', 'microsoft yahei', 'microsoft yi baiti', 'mingliu-extb', 'mongolian baiti',
  'ms gothic', 'mv boli', 'myanmar text', 'nirmala ui', 'palatino linotype', 'segoe mdl2 assets', 'segoe print', 'segoe script',
  'segoe ui', 'segoe ui emoji', 'segoe ui historic', 'segoe ui symbol', 'segoe ui variable', 'simsun', 'sitka', 'sylfaen',
  'symbol', 'tahoma', 'times new roman', 'trebuchet ms', 'verdana', 'webdings', 'wingdings', 'yu gothic']);
export const WINDOWS_OPTIONAL_FONTS = Object.freeze(['agency fb', 'algerian', 'book antiqua', 'bookman old style', 'bodoni mt',
  'broadway', 'calibri light', 'castellar', 'century', 'century gothic', 'garamond', 'gill sans mt', 'harrington',
  'lucida bright', 'lucida handwriting', 'monotype corsiva', 'onyx', 'papyrus', 'perpetua', 'rockwell', 'stencil', 'tw cen mt']);


export function nativeIdentityFor(profileId) {
  const digest = createHash('sha256').update('azwah-native-identity\n' + String(profileId)).digest();
  const [webglVendor, webglRenderer, webgpuArchitecture] = WINDOWS_GPUS[digest[0] % WINDOWS_GPUS.length];
  const family = /\((NVIDIA|Intel|AMD)\)/.exec(webglVendor)[1];
  const hardwareConcurrency = CORES[digest[1] % CORES.length];
  const platformVersion = PLATFORM_VERSIONS[digest[28] % PLATFORM_VERSIONS.length];
  // Segoe UI Variable ships only with Windows 11.
  const base = platformVersion === '10.0.0' ? WINDOWS_BASE_FONTS.filter((f) => f !== 'segoe ui variable') : WINDOWS_BASE_FONTS;
  const optional = WINDOWS_OPTIONAL_FONTS.filter((_, i) => digest[4 + (i % 24)] & (1 << (i % 8)));
  return { hardwareConcurrency, deviceMemory: memoryFor(hardwareConcurrency, digest[2]), webglVendor, webglRenderer,
    screen: SCREENS[digest[3] % SCREENS.length], webgpuVendor: family.toLowerCase(), webgpuArchitecture,
    fonts: [...base, ...optional], platformVersion,
    voices: WINDOWS_VOICES.filter((_, i) => i === 0 || (digest[29] >> i) & 1) };
}

// The window fits inside the reported screen and its taskbar-free area, like a maximised-but-not-fullscreen window.
export function windowSizeFor(screen) {
  const [w, h] = String(screen).split('x').map(Number);
  return `${Math.round(w * 0.92)},${Math.round((h - 40) * 0.92)}`;
}

export function nativeIdentityArgs(identity, { screen = false, gpuFonts = false, clientHints = false, voicesBattery = false } = {}) {
  return [
    ...(screen && identity.screen ? [`--window-size=${windowSizeFor(identity.screen)}`] : []),
    ...(voicesBattery ? [`--azwah-voice-allowlist=${identity.voices.join('|')}`, '--azwah-battery-desktop'] : []),
    ...(clientHints ? [`--azwah-ua-platform-version=${identity.platformVersion}`, '--azwah-ua-chrome-brand'] : []),
    ...(gpuFonts ? [`--azwah-font-allowlist=${identity.fonts.join(',')}`, `--azwah-webgpu-vendor=${identity.webgpuVendor}`,
      `--azwah-webgpu-architecture=${identity.webgpuArchitecture}`] : []),
    ...(screen && identity.screen ? [`--azwah-screen=${identity.screen}`] : []),
    `--azwah-hardware-concurrency=${identity.hardwareConcurrency}`,
    `--azwah-device-memory=${identity.deviceMemory}`,
    `--azwah-webgl-vendor=${identity.webglVendor}`,
    `--azwah-webgl-renderer=${identity.webglRenderer}`,
  ];
}
