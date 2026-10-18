// Offline Windows build: same as package.json "build", plus bundled Chromium in resources/browsers.
// Used by `npm run dist:win:offline` (after scripts/fetch-bundled-chromium.mjs fills build/bundled-browsers).
const base = require('./package.json').build;
module.exports = {
  ...base,
  extraResources: [{ from: 'build/bundled-browsers', to: 'browsers', filter: ['**/*', '!.download-*'] }],
  nsis: { ...base.nsis, artifactName: '${productName}-Setup-${version}-x64-offline.${ext}' },
  portable: { ...base.portable, artifactName: '${productName}-${version}-x64-offline-portable.${ext}' },
};
