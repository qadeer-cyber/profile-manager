module.exports = {
  appId: 'dev.azwah.privacyprototype',
  productName: 'Azwah Privacy Prototype',
  executableName: 'AzwahPrivacyPrototype',
  artifactName: 'AzwahPrivacyPrototype-Setup.exe',
  electronVersion: require('../node_modules/electron/package.json').version,
  files: ['main.js', 'config.js', 'managed.js', 'proxy-identity.js', 'location-verification.js', 'browser-state.js', 'extension-policy.js', 'toolbar*', 'package.json'],
  directories: { output: 'out' },
  win: { target: 'nsis', signAndEditExecutable: false },
  nsis: { perMachine: false, oneClick: true, deleteAppDataOnUninstall: false },
};
