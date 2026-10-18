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
// signal handlers never run, so parents must also send an IPC 'shutdown' message (fork).
let closing = false;
const SHUTDOWN_MS = Number(process.env.PM_SHUTDOWN_TIMEOUT_MS || 20000);
function shutdown() {
  if (closing) return;
  closing = true;
  const force = setTimeout(() => {
    console.error(`Shutdown timed out after ${SHUTDOWN_MS}ms; forcing exit`);
    process.exit(1);
  }, SHUTDOWN_MS);
  force.unref();
  s.close().then(() => {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
    try { db.close(); } catch {}
    process.exit(0);
  }, err => {
    console.error(err);
    try { db.close(); } catch {}
    process.exit(1);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
if (process.platform === 'win32') process.on('SIGBREAK', shutdown);
process.on('message', m => {
  if (m === 'shutdown' || (m && typeof m === 'object' && m.type === 'shutdown')) shutdown();
});
