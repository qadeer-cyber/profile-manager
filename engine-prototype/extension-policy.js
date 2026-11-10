const fields = new Set([
  'manifest_version', 'name', 'short_name', 'description', 'version', 'version_name',
  'author', 'default_locale', 'minimum_chrome_version', 'key', 'icons',
  'permissions', 'host_permissions', 'content_scripts',
]);

export function dedicatedExtensionIssue(manifest) {
  if (manifest?.manifest_version !== 3) return 'Only supported Manifest V3 extensions can be loaded.';
  const unsupported = Object.keys(manifest).filter(key => !fields.has(key));
  if (unsupported.length) return 'Unsupported manifest fields: ' + unsupported.join(', ') + '.';
  if (manifest.permissions?.some(permission => permission !== 'storage')) return 'Only the storage API permission is supported.';
  if (!Array.isArray(manifest.content_scripts) || !manifest.content_scripts.length) return 'An eligible extension must contain declarative content scripts.';
  if (manifest.content_scripts.some(script => script?.world && script.world !== 'ISOLATED')) return 'Content scripts must run in an isolated world.';
  return null;
}
