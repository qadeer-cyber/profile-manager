// Isolated packaging qualification only. This never creates a release-ready root.
const base = require('./electron-builder.offline.cjs');
if (process.env.CI !== 'true' || process.env.AZWAH_ISOLATED_PACKAGE_TEST !== '1' || !process.env.AZWAH_PACKAGE_TEST_OUTPUT) throw Error('Isolated Windows packaging test environment required');
module.exports = {
  ...base,
  directories: { ...base.directories, output: process.env.AZWAH_PACKAGE_TEST_OUTPUT },
  nsis: { ...base.nsis, artifactName: 'Azwah-Multi-Browser-Office-Experimental-Setup-x64.exe' },
};
