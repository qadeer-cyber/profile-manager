const base = require('./electron-builder.ultimate-firefox-owner.cjs');
const firefox = require('./scripts/firefox-extra-resources.cjs');
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
    ...firefox.filter(item => !(base.extraResources || []).some(existing => existing.to === item.to)),
    {from: 'release-office-payload/win-unpacked', to: 'office-payload'},
    {from: 'build/admin-nsis', to: 'nsis'},
    {from: 'admin-desktop/office.nsi', to: 'office.nsi'},
  ],
  nsis: {...base.nsis, shortcutName: 'Azwah Multi Browser Ultimate', artifactName: 'Azwah-Multi-Browser-Ultimate-Setup-x64.exe'},
};
