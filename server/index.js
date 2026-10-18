// CLI entry: node server/index.js  (web UI + API at http://127.0.0.1:3000)
import path from 'path';
import { startServer } from './app.js';
import { DATA_DIR, db } from './db.js';

const s = await startServer();
console.log(`Profile manager on ${s.url}`);
console.log(`API token: ${process.env.PM_API_TOKEN ? '(from PM_API_TOKEN)' : path.join(DATA_DIR, 'api-token')}`);
if (s.migration.applied.length) console.log(`Database migrated v${s.migration.from} -> v${s.migration.to}`);
const { killed, cleared, staleLocks } = s.recovery;
if (cleared || staleLocks) console.log(`Recovery: cleared ${cleared} running record(s), ${staleLocks} stale lock(s), killed ${killed} orphaned browser(s)`);
if (s.reencrypted) console.log(`Re-encrypted ${s.reencrypted} proxy secret(s)`);

// Graceful shutdown. On Windows, process.kill(pid, 'SIGTERM') is TerminateProcess and these
// signal handlers never run, so parents must also send an IPC shutdown message (fork).
// Protocol: {type:'shutdown'} or the string 'shutdown' -> stopAll (s.close) ->
// wal_checkpoint and db.close both succeed -> {type:'shutdown-done'} -> exit 0.
// If the checkpoint or db.close throws: log, exit 1, and send no ack.
let closing = false;
const SHUTDOWN_MS = Number(process.env.PM_SHUTDOWN_TIMEOUT_MS || 20000);
const SHUTDOWN_ACK_SEND_MS = 5000;
function notifyShutdownDone() {
  return new Promise(resolve => {
    if (typeof process.send !== 'function') return resolve();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    // process.send returns false under backpressure, but the callback still runs
    // once the write finishes. Resolving on false exits before the parent can
    // read the ack. If the callback never comes, give up so the harness records
    // a missing ack instead of hanging.
    const timer = setTimeout(finish, SHUTDOWN_ACK_SEND_MS);
    try {
      process.send({ type: 'shutdown-done' }, () => finish());
    } catch {
      finish();
    }
  });
}
async function shutdown() {
  if (closing) return;
  closing = true;
  const force = setTimeout(() => {
    console.error(`Shutdown timed out after ${SHUTDOWN_MS}ms; forcing exit`);
    process.exit(1);
  }, SHUTDOWN_MS);
  force.unref();
  try {
    await s.close(); // engine.shutdown() closes every browser context, then the HTTP server
    let checkpointOk = false;
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      checkpointOk = true;
    } catch (err) {
      console.error(err);
    }
    let closedOk = false;
    try {
      db.close();
      closedOk = true;
    } catch (err) {
      console.error(err);
    }
    if (!checkpointOk || !closedOk) {
      process.exit(1);
      return;
    }
    await notifyShutdownDone();
    process.exit(0);
  } catch (err) {
    console.error(err);
    try { db.close(); } catch (closeErr) { console.error(closeErr); }
    process.exit(1);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
if (process.platform === 'win32') process.on('SIGBREAK', shutdown);
process.on('message', m => {
  if (m === 'shutdown' || (m && typeof m === 'object' && m.type === 'shutdown')) shutdown();
});
