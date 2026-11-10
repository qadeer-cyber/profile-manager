const base = require('./electron-builder.ultimate-unified.cjs');
module.exports = {
  ...base,
  extraMetadata: { ...base.extraMetadata, azwahChromiumRuntime: 'stable-chrome' },
  extraResources: base.extraResources.filter(({ to }) => !['browsers', 'privacy-engine', 'native-chromium'].includes(to)),
  directories: { ...base.directories, output: 'release-ultimate-stable' },
  nsis: { ...base.nsis, artifactName: 'Azwah-Ultimate-Stable-Chrome-Setup-x64.exe' },
};
