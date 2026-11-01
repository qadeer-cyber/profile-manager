import { connectMarionette } from './marionette-client.js';
import { firefoxSessionIdentity } from './firefox-session.js';
import { pidMatches } from './proc.js';
import { requestNativeWindowClose } from './native-window-state.js';

// A request is not proof of termination: the caller must wait for the owned PID
// to exit before releasing its profile lock or offering a portable snapshot.
export async function requestFirefoxShutdown({ pid, profileDir, marionettePort }, { connect = connectMarionette, matches = pidMatches, closeWindow = requestNativeWindowClose } = {}) {
  if (!await matches(pid, profileDir)) return false;
  let client, created = false, quitSent = false;
  if (marionettePort) {
    try {
      client = await connect(marionettePort, 3000);
      const session = await client.command('WebDriver:NewSession', {}); created = true;
      firefoxSessionIdentity(session, profileDir, pid);
      quitSent = true;
      try { await client.command('Marionette:Quit', { flags: ['eAttemptQuit'] }); }
      catch (e) { if (!/Marionette connection closed/.test(e.message)) throw e; }
      return true;
    } catch { /* An occupied/failed automation session does not bypass identity checks. */ }
    finally {
      if (created && !quitSent) await client.command('WebDriver:DeleteSession').catch(() => {});
      client?.close();
    }
  }
  // Recheck ownership before sending WM_CLOSE, including when another automation
  // client owns the Marionette session. No unrelated window receives the request.
  if (!await matches(pid, profileDir)) return false;
  try { return await closeWindow(pid); } catch { return false; }
}
