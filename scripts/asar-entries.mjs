// asar.listPackage joins names with the host path module, so Windows listings use backslashes.
export function normalizeAsarEntry(name) {
  return String(name).replaceAll('\\', '/').replace(/^\/+/, '');
}

export function asarHasEntry(entries, relativePath) {
  const target = normalizeAsarEntry(relativePath);
  return entries.some(entry => normalizeAsarEntry(entry) === target);
}

// extractFile walks with path.dirname and path.sep. On Windows, dirname('a/b/c')
// stays 'a/b', and splitting that on backslash does not enter the nested directory.
export function asarLookupPath(relativePath) {
  const normalized = normalizeAsarEntry(relativePath);
  return process.platform === 'win32' ? normalized.replaceAll('/', '\\') : normalized;
}
