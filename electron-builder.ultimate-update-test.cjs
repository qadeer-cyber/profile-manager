// Milestone D CI only: builds "Beta B" for the installed update test. Same app and payload as
// electron-builder.ultimate-stable.cjs; only the version and output folder differ. Never published.
const stable = require('./electron-builder.ultimate-stable.cjs');
module.exports = {
  ...stable,
  extraMetadata: { ...stable.extraMetadata, version: '2.0.0-beta.2' },
  directories: { ...stable.directories, output: 'release-update-b' },
};
