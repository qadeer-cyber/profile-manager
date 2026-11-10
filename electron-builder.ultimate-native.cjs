// Release-only configuration for the *source-compiled* Azwah Chromium browser.
// Deliberately separate from the existing prototype/compatibility QA installers.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const base = require('./electron-builder.ultimate-unified.cjs');
if (process.env.AZWAH_NATIVE_RELEASE !== '1') {
  throw new Error('AZWAH_NATIVE_RELEASE=1 required; cannot package a reduced-feature Ultimate as native.');
}
if (process.env.AZWAH_PRIVACY_ENGINE_QA_BUNDLE === '1') {
  throw new Error('The Electron privacy prototype is not a substitute for patched native Chromium.');
}
const stage = path.resolve('build/native-chromium-runtime');
if (!fs.existsSync(path.join(stage, 'BASELINE-MANIFEST.json'))) {
  throw new Error('No newly compiled, provenance-verified Azwah Chromium binary was staged. Refusing Ultimate native installer.');
}
// Validation fails on incorrect pins, missing patch provenance, changed hashes,
// invalid PE headers and incomplete runtime resources.
execFileSync(process.execPath, [path.join(__dirname, 'scripts/verify-native-release-stage.mjs'), stage], {
  stdio: 'inherit',
});
module.exports = {
  ...base,
  productName: 'Azwah',
  extraMetadata: { ...base.extraMetadata, azwahChromiumRuntime: 'custom-native-chromium' },
  directories: {...base.directories, output: 'release-azwah'},
  extraResources: [
    ...(base.extraResources || []).filter(entry => !['privacy-engine', 'browsers'].includes(entry.to)),
    {from: stage, to: 'native-chromium'},
  ],
  nsis: {
    ...base.nsis,
    deleteAppDataOnUninstall: false,
    shortcutName: 'Azwah',
    artifactName: 'Azwah-Setup-x64.exe',
  },
  win: {...base.win, signAndEditExecutable: false},
};
