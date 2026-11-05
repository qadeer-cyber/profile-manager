// One authenticated application owner per Firefox BiDi process. Borrowers never
// create or end a remote session and cannot release the owner's profile lock.
import { connectFirefoxBidi, setFirefoxTimezone } from './firefox-bidi.js';
import { firefoxSessionIdentity } from './firefox-session.js';
import { pidMatches } from './proc.js';
import { acquireFirefoxSession } from './firefox-session-lock.js';
const sessions = new Map();
const fail = (message, code = 'FIREFOX_SESSION_UNAVAILABLE') => Object.assign(Error(message), { status: 409, code });
export function firefoxSessionStatus(id) {
  const s = sessions.get(id);
  return s ? { mode: 'bidi', pid: s.pid, timezone: s.timezone, state: s.state, busy: s.busy } : null;
}
export async function ownFirefoxSession({ id, port, profileDir, timezone, locale }) {
  if (sessions.has(id)) throw fail('A Firefox session already owns this profile', 'FIREFOX_SESSION_BUSY');
  const record = { profileDir, timezone, locale, state: 'starting', busy: false, pid: null, client: null };
  sessions.set(id, record);
  try {
    record.client = await connectFirefoxBidi(port, 15000, () => { record.state = 'disconnected'; });
    const result = await record.client.command('session.new', { capabilities: {} });
    record.pid = firefoxSessionIdentity(result, profileDir).pid;
    if (!await pidMatches(record.pid, profileDir)) throw fail('Firefox process ownership could not be verified');
    if (timezone) await setFirefoxTimezone(record.client, timezone);
    if (locale) await record.client.command('emulation.setLocaleOverride', { locale, userContexts: ['default'] });
    record.state = 'ready';
    return { pid: record.pid };
  } catch (error) {
    record.client?.close();
    if (sessions.get(id) === record) sessions.delete(id);
    throw error;
  }
}
export async function borrowFirefoxSession(id, owner, action) {
  const record = sessions.get(id);
  if (!record || record.state !== 'ready') throw fail('Firefox remote session is unavailable. Stop and relaunch the profile before retrying.');
  const release = acquireFirefoxSession(id, owner);
  record.busy = true;
  try {
    if (!await pidMatches(record.pid, record.profileDir)) throw fail('Firefox process no longer matches its profile');
    const client = { command: async (method, params) => {
      try { return await record.client.command(method, params); }
      catch (error) {
        if (/connection closed|transport failed|unavailable|timeout/i.test(error.message)) record.state = 'disconnected';
        throw error;
      }
    } };
    return await action(client);
  } finally { record.busy = false; release(); }
}
export function releaseFirefoxSession(id, pid) {
  const record = sessions.get(id);
  if (!record || record.pid !== pid) return;
  record.client?.close(); sessions.delete(id);
}
export const FIREFOX_AUTOMATION_COMMANDS = new Set(['browser.createUserContext', 'browser.removeUserContext', 'browsingContext.getTree', 'browsingContext.create', 'browsingContext.navigate', 'browsingContext.close', 'script.evaluate', 'script.callFunction', 'script.getRealms', 'input.performActions', 'input.releaseActions']);
export async function firefoxAutomationCommand(id, method, params) {
  if (!FIREFOX_AUTOMATION_COMMANDS.has(method)) throw fail('This command is not available through the application-owned Firefox session.', 'FIREFOX_COMMAND_FORBIDDEN');
  return borrowFirefoxSession(id, 'automation', async client => {
    const result = await client.command(method, params);
    if (method === 'browser.createUserContext') {
      const record = sessions.get(id);
      if (record.timezone) await client.command('emulation.setTimezoneOverride', { timezone: record.timezone, userContexts: [result.userContext] });
      if (record.locale) await client.command('emulation.setLocaleOverride', { locale: record.locale, userContexts: [result.userContext] });
    }
    return result;
  });
}
