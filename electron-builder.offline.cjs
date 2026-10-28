// Offline Windows build: NSIS setup only, with bundled Chromium in resources/browsers.
// Dispatch uses: node scripts/fetch-bundled-chromium.mjs win64
//   && electron-builder --config electron-builder.offline.cjs --win nsis --x64
const base = require('./package.json').build;
// Linux cannot node-gyp a Windows native module. better-sqlite3 ships an N-API
// win32-x64 prebuild, which Electron loads without a from-source rebuild.
const files = base.files.flatMap(pattern => pattern === '!node_modules/better-sqlite3/prebuilds/**'
  ? [
      '!node_modules/better-sqlite3/prebuilds/darwin-*',
      '!node_modules/better-sqlite3/prebuilds/linux*',
      '!node_modules/better-sqlite3/prebuilds/win32-arm64.node',
      '!node_modules/better-sqlite3/build/**',
    ]
  : [pattern]);
module.exports = {
  ...base,
  npmRebuild: false,
  // NSIS finalizes the uninstaller by running the installer once. Linux has no
  // system Wine, so use electron-builder's pinned Wine toolset.
  toolsets: { wine: '1.0.1' },
  files,
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
