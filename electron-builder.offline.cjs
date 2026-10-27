// Offline Windows build: NSIS setup only, with bundled Chromium in resources/browsers.
// Dispatch uses: node scripts/fetch-bundled-chromium.mjs win64
//   && electron-builder --config electron-builder.offline.cjs --win nsis --x64
const base = require('./package.json').build;
module.exports = {
  ...base,
  extraResources: [{ from: 'build/bundled-browsers', to: 'browsers', filter: ['**/*', '!.download-*'] }],
  win: { ...base.win, target: [{ target: 'nsis', arch: ['x64'] }] },
  nsis: {
    ...base.nsis,
    oneClick: false,
    perMachine: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
    artifactName: '${productName}-offline-Setup-${version}-x64.${ext}',
  },
};
