module.exports = async context => {
  const fs = require('node:fs');
  const path = require('node:path');
  const config = context.packager.config;
  if (config.appId !== 'local.azwahmultibrowser.ultimate' || config.extraMetadata?.name !== 'azwah-multi-browser-ultimate' || config.extraMetadata?.azwahEdition !== 'ultimate') {
    throw new Error('Explicit Ultimate distribution policy required');
  }
  if (!config.files?.some(item => String(item).includes('license-admin'))) throw new Error('Ultimate package must include the in-process license administration module');
  if (fs.existsSync(path.join(__dirname, '../server/office/issuer-public.pem'))) throw new Error('Ultimate build must not bake in an Office issuer identity');
  for (const entry of fs.readdirSync(path.join(__dirname, '../server/office'), {withFileTypes: true})) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) throw new Error('Unexpected key or vault material in employee modules');
  }
};
