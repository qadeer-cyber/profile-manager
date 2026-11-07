// asar.listPackage joins names with the host path module, so Windows listings use backslashes.
export function normalizeAsarEntry(name) {
  return String(name).replaceAll('\\', '/').replace(/^\/+/, '');
}

export function asarHasEntry(entries, relativePath) {
  const target = normalizeAsarEntry(relativePath);
  return entries.some(entry => normalizeAsarEntry(entry) === target);
}
