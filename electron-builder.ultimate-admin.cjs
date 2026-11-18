const base = require('./electron-builder.license-admin.cjs');
module.exports = {
  ...base,
  directories: { ...base.directories, output: 'release-ultimate-admin' },
  nsis: { ...base.nsis, artifactName: 'Azwah-License-Admin-Ultimate-Setup-x64.exe' },
};
