const base = require('./electron-builder.ultimate-unified.cjs');
module.exports = {
  ...base,
  productName: 'AZWAH',
  win: { ...base.win, icon: 'assets/azwah.ico', signAndEditExecutable: true },
  extraMetadata: { ...base.extraMetadata, azwahChromiumRuntime: 'stable-chrome', azwahProductName: 'AZWAH' },
  extraResources: base.extraResources.filter(({ to }) => !['browsers', 'privacy-engine', 'native-chromium'].includes(to)),
  directories: { ...base.directories, output: 'release-ultimate-stable' },
  nsis: { ...base.nsis, shortcutName: 'AZWAH', artifactName: 'Azwah-Setup-x64.exe' },
};
