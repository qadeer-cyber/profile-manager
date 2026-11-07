const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'build', 'bundled-firefox');
for (const name of ['firefox/firefox.exe', 'firefox/application.ini', 'FIREFOX-REDISTRIBUTION.txt', 'MPL-2.0.txt', 'firefox-runtime.json']) {
  if (!fs.existsSync(path.join(root, name))) throw new Error(`Missing staged Firefox file ${name}. Run node scripts/fetch-bundled-firefox.mjs on the build host.`);
}
module.exports = [
  {from: 'build/bundled-firefox/firefox', to: 'firefox'},
  {from: 'build/bundled-firefox/FIREFOX-REDISTRIBUTION.txt', to: 'FIREFOX-REDISTRIBUTION.txt'},
  {from: 'build/bundled-firefox/MPL-2.0.txt', to: 'MPL-2.0.txt'},
  {from: 'build/bundled-firefox/firefox-runtime.json', to: 'firefox-runtime.json'},
];
