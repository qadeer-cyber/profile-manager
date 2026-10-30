import { api } from '../api.js';

/** Assign direct or library proxy via the safe switch API (blocks templates/paused server-side). */
export async function switchProfileProxy(profileId, { proxyId = null } = {}) {
  const body = proxyId ? { mode: 'library', proxyId } : { mode: 'direct' };
  return api(`/api/profiles/${profileId}/proxy/switch`, { method: 'POST', body });
}

export function assignableLibraryProxies(list) {
  return (list || []).filter(p => !p.tags?.includes('template') && !p.tags?.includes('paused'));
}
