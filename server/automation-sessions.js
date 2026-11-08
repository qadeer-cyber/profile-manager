import { randomUUID } from 'node:crypto';
import { db } from './db.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const time = () => new Date().toISOString();

function publicSession(row) {
  return {
    id: row.id, status: row.status, startedAt: row.started_at, endedAt: row.ended_at, error: row.error,
  };
}

const active = profileId => db.prepare("SELECT * FROM automation_sessions WHERE profile_id=? AND status IN ('ready','stopping')").get(profileId);
const finish = (id, status, error = null) => db.prepare('UPDATE automation_sessions SET status=?, error=?, ended_at=? WHERE id=?').run(status, error, time(), id);

export function recoverAutomationSessions() {
  db.prepare("UPDATE automation_sessions SET status='interrupted', ended_at=?, error=? WHERE status IN ('ready','stopping')")
    .run(time(), 'The application restarted during this session.');
}

export function automationBrowserEnded(profileId, currentLaunch, crashed) {
  const row = active(profileId);
  if (row && row.status !== 'stopping' && row.launch_id !== currentLaunch?.id) {
    finish(row.id, crashed ? 'interrupted' : 'ended', crashed ? 'The browser exited unexpectedly.' : null);
  }
}

export function automationSessions(profileId, currentLaunch) {
  const row = active(profileId);
  if (row?.status === 'ready' && row.launch_id !== currentLaunch?.id) {
    finish(row.id, 'interrupted', 'The browser session is no longer available.');
  }
  const history = db.prepare('SELECT * FROM automation_sessions WHERE profile_id=? ORDER BY rowid DESC LIMIT 20').all(profileId);
  return {
    sessions: history.map(publicSession),
    canStart: Boolean(currentLaunch && row?.launch_id !== currentLaunch.id),
    endpoint: row?.status === 'ready' && row.launch_id === currentLaunch?.id ? currentLaunch.endpoint : null,
  };
}

export function startAutomationSession(profileId, currentLaunch) {
  if (!currentLaunch) throw fail(409, 'Launch this Chromium profile with automation enabled first.');
  automationSessions(profileId, currentLaunch);
  if (active(profileId)) throw fail(409, 'This profile already has a managed automation session.');
  db.prepare("INSERT INTO automation_sessions (id,profile_id,launch_id,status,started_at) VALUES (?,?,?,'ready',?)")
    .run(randomUUID(), profileId, currentLaunch.id, time());
  return automationSessions(profileId, currentLaunch);
}

export async function cancelAutomationSession(profileId, sessionId, getLaunch, stop) {
  const row = active(profileId);
  if (!row || row.id !== sessionId) throw fail(404, 'Active automation session not found.');
  if (row.status === 'stopping') throw fail(409, 'Cancellation is already in progress.');
  if (row.launch_id !== getLaunch()?.id) {
    finish(row.id, 'interrupted', 'The browser session is no longer available.');
    return automationSessions(profileId, getLaunch());
  }
  db.prepare("UPDATE automation_sessions SET status='stopping', error=NULL WHERE id=?").run(row.id);
  try {
    await stop();
  } catch {
    if (row.launch_id === getLaunch()?.id) {
      db.prepare("UPDATE automation_sessions SET status='ready', error=? WHERE id=?")
        .run('The browser could not be stopped. Retry cancellation.', row.id);
    } else {
      finish(row.id, 'interrupted', 'The browser stopped without confirming cancellation.');
    }
    return automationSessions(profileId, getLaunch());
  }
  finish(row.id, 'cancelled');
  return automationSessions(profileId, getLaunch());
}
