const path = require('node:path');
const { execFileSync } = require('node:child_process');
const base = require('./electron-builder.ultimate-unified.cjs');
// Owner decision 2026-11-24: the AZWAH installer carries AZWAH's own Chromium (default browser for new profiles).
// Included only when CI staged a provenance-verified build; the verifier fails closed on any pin or hash mismatch.
const nativeStage = path.resolve('build/native-chromium-runtime');
const includeNative = process.env.AZWAH_INCLUDE_NATIVE_CHROMIUM === '1';
if (includeNative) {
  execFileSync(process.execPath, [path.join(__dirname, 'scripts/verify-native-release-stage.mjs'), nativeStage], { stdio: 'inherit' });
}
module.exports = {
  ...base,
  productName: 'AZWAH',
  win: { ...base.win, icon: 'assets/azwah.ico', signAndEditExecutable: true },
  extraMetadata: { ...base.extraMetadata, azwahChromiumRuntime: 'stable-chrome', azwahProductName: 'AZWAH', version: '2.0.0-beta.1' },
  extraResources: [
    ...base.extraResources.filter(({ to }) => !['browsers', 'privacy-engine', 'native-chromium'].includes(to)),
    { from: 'build/geoip-dbip', to: 'geoip-dbip' },
    { from: 'build/geoip-dbip-asn', to: 'geoip-dbip-asn' },
    ...(includeNative ? [{ from: nativeStage, to: 'native-chromium' }] : []),
  ],
  directories: { ...base.directories, output: 'release-ultimate-stable' },
  nsis: { ...base.nsis, shortcutName: 'AZWAH', artifactName: 'Azwah-Setup-x64.exe' },
};
