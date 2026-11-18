// Process-local ownership of application-managed Marionette sessions.
// Firefox itself rejects an independently occupied external session.
const owners = new Map();
export function firefoxSessionOwner(id) { return owners.get(id)?.owner || null; }
export function acquireFirefoxSession(id, owner) {
  if (owners.has(id)) throw Object.assign(Error('Firefox automation is busy. Close the active session before retrying.'), { status: 409, code: 'FIREFOX_SESSION_BUSY' });
  const token = { owner }; owners.set(id, token);
  return () => { if (owners.get(id) === token) owners.delete(id); };
}
export function assertFirefoxAddonIdle(id) {
  if (firefoxSessionOwner(id) === 'addons') throw Object.assign(Error('Wait for Firefox extension management to finish before stopping this profile.'), { status: 409, code: 'FIREFOX_SESSION_BUSY' });
}
