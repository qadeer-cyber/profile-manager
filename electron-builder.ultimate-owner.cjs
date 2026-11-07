const base = require('./electron-builder.owner.cjs');
module.exports = {
  ...base,
  directories: { ...base.directories, output: 'release-ultimate-owner' },
  nsis: { ...base.nsis, artifactName: 'Azwah-Multi-Browser-Ultimate-Setup-x64.exe' },
};
