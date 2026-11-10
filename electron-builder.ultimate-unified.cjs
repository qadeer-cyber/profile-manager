const path = require('node:path');
const fs = require('node:fs');
const base = require('./electron-builder.ultimate-firefox-owner.cjs');
const firefox = require('./scripts/firefox-extra-resources.cjs');
const qaEngine = process.env.AZWAH_PRIVACY_ENGINE_QA_BUNDLE === '1'
  ? path.join(__dirname, 'engine-prototype', 'out', 'win-unpacked') : null;
if (qaEngine && !fs.existsSync(path.join(qaEngine, 'AzwahPrivacyPrototype.exe'))) {
  throw new Error('Build the dedicated Windows QA engine before bundling it.');
}
module.exports = {
  ...base,
  appId: 'local.azwahmultibrowser.ultimate',
  productName: 'Azwah Multi Browser Ultimate',
  extraMetadata: {
    name: 'azwah-multi-browser-ultimate',
    azwahEdition: 'ultimate',
    azwahLicensePolicy: 'browser-without-activation-admin-vault-in-process',
  },
  directories: {...base.directories, output: 'release-ultimate'},
  files: [...new Set([...(base.files || []), 'scripts/license-admin/**', 'admin-desktop/office.nsi'])],
  extraResources: [
    ...(base.extraResources || []),
    ...(qaEngine ? [{from: qaEngine, to: 'privacy-engine'}] : []),
    ...firefox.filter(item => !(base.extraResources || []).some(existing => existing.to === item.to)),
    {from: 'release-office-payload/win-unpacked', to: 'office-payload'},
    {from: 'build/admin-nsis', to: 'nsis'},
    {from: 'admin-desktop/office.nsi', to: 'office.nsi'},
  ],
  nsis: {...base.nsis, shortcutName: 'Azwah Multi Browser Ultimate', artifactName: 'Azwah-Multi-Browser-Ultimate-Setup-x64.exe'},
  win: {...(base.win || {}), signAndEditExecutable: false},
  beforePack: 'scripts/ultimate-before-pack.cjs',
};
