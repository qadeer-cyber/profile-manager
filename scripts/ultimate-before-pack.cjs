function patterns(files) {
  const list = Array.isArray(files) ? files : files == null ? [] : [files];
  const out = [];
  for (const item of list) {
    if (typeof item === 'string') out.push(item);
    else if (item && typeof item.filter === 'string') out.push(item.filter);
    else if (item && Array.isArray(item.filter)) out.push(...item.filter.filter(pattern => typeof pattern === 'string'));
  }
  return out;
}

function globMatch(pattern, file) {
  const source = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  const target = file.replace(/\\/g, '/');
  const expression = new RegExp('^' + source
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DEEP::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DEEP::/g, '.*') + '$');
  return expression.test(target);
}

function includesPath(files, relativePath) {
  let included = false;
  for (const pattern of patterns(files)) {
    const negated = pattern.startsWith('!');
    if (globMatch(negated ? pattern.slice(1) : pattern, relativePath)) included = !negated;
  }
  return included;
}

module.exports = async context => {
  const fs = require('node:fs');
  const path = require('node:path');
  const config = context.packager.config;
  if (config.appId !== 'local.azwahmultibrowser.ultimate' || config.extraMetadata?.name !== 'azwah-multi-browser-ultimate' || config.extraMetadata?.azwahEdition !== 'ultimate') {
    throw new Error('Explicit Ultimate distribution policy required');
  }
  // electron-builder normalizes string globs into {filter: [...]} before beforePack.
  // String(item) is then "[object Object]" and cannot see the administration module.
  const adminModule = 'scripts/license-admin/admin.mjs';
  if (!includesPath(config.files, adminModule) || !fs.existsSync(path.join(__dirname, '../scripts/license-admin/admin.mjs')) || !fs.existsSync(path.join(__dirname, '../server/ultimate-admin.js'))) {
    throw new Error('Ultimate package must include the in-process license administration module');
  }
  if (fs.existsSync(path.join(__dirname, '../server/office/issuer-public.pem'))) throw new Error('Ultimate build must not bake in an Office issuer identity');
  for (const entry of fs.readdirSync(path.join(__dirname, '../server/office'), {withFileTypes: true})) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) throw new Error('Unexpected key or vault material in employee modules');
  }
};
