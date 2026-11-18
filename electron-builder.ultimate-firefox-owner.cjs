const base = require('./electron-builder.ultimate-owner.cjs');
const firefox = require('./scripts/firefox-extra-resources.cjs');
module.exports = {
  ...base,
  extraResources: [...(base.extraResources || []), ...firefox],
};
