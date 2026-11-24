// Per-profile hardware and graphics identity for AZWAH Chromium (identity.patch). Values are realistic for a Windows
// desktop and derived from the profile id, so a profile keeps the same identity on every launch while different
// profiles differ. Only Windows desktop GPUs (Direct3D 11 through ANGLE, as Chrome on Windows reports them) are used,
// because the browser really runs on Windows.
import { createHash } from 'node:crypto';

export const WINDOWS_GPUS = Object.freeze([
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)'],
].map(Object.freeze));
const CORES = Object.freeze([4, 6, 8, 8, 12, 16]);
// Common Windows desktop and laptop screens.
const SCREENS = Object.freeze(['1920x1080', '1920x1080', '1366x768', '1536x864', '2560x1440', '1600x900', '1440x900']);
const MEMORY = Object.freeze([4, 8, 8]);

export function nativeIdentityFor(profileId) {
  const digest = createHash('sha256').update('azwah-native-identity\n' + String(profileId)).digest();
  const [webglVendor, webglRenderer] = WINDOWS_GPUS[digest[0] % WINDOWS_GPUS.length];
  return { hardwareConcurrency: CORES[digest[1] % CORES.length], deviceMemory: MEMORY[digest[2] % MEMORY.length], webglVendor, webglRenderer,
    screen: SCREENS[digest[3] % SCREENS.length] };
}

export function nativeIdentityArgs(identity, { screen = false } = {}) {
  return [
    ...(screen && identity.screen ? [`--azwah-screen=${identity.screen}`] : []),
    `--azwah-hardware-concurrency=${identity.hardwareConcurrency}`,
    `--azwah-device-memory=${identity.deviceMemory}`,
    `--azwah-webgl-vendor=${identity.webglVendor}`,
    `--azwah-webgl-renderer=${identity.webglRenderer}`,
  ];
}
