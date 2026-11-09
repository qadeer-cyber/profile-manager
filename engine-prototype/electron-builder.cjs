const path = require('node:path');
module.exports = {
  appId: 'dev.azwah.privacyprototype',
  productName: 'Azwah Privacy Prototype',
  executableName: 'AzwahPrivacyPrototype',
  artifactName: 'AzwahPrivacyPrototype-Setup.exe',
  electronVersion: require('../node_modules/electron/package.json').version,
  electronDist: path.resolve(__dirname, '../node_modules/electron/dist'),
  files: ['main.js', 'config.js', 'package.json'],
  directories: { output: 'out' },
  win: { target: 'nsis', signAndEditExecutable: false },
  nsis: { perMachine: false, oneClick: true, deleteAppDataOnUninstall: false },
};
