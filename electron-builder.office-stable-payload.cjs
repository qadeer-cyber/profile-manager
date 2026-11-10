const base = require('./electron-builder.office-payload.cjs');
module.exports = {
  ...base,
  extraMetadata: { ...base.extraMetadata, azwahChromiumRuntime: 'stable-chrome' },
  extraResources: base.extraResources.filter(({ to }) => !['browsers', 'privacy-engine', 'native-chromium'].includes(to)),
  directories: { ...base.directories, output: 'release-office-payload' },
};
