// CLI entry: node server/index.js  (web UI + API at http://127.0.0.1:3000)
import path from 'path';
import { startServer } from './app.js';
import { DATA_DIR } from './db.js';

const s = await startServer();
console.log(`Profile manager on ${s.url}`);
console.log(`API token: ${process.env.PM_API_TOKEN ? '(from PM_API_TOKEN)' : path.join(DATA_DIR, 'api-token')}`);
if (s.migration.applied.length) console.log(`Database migrated v${s.migration.from} -> v${s.migration.to}`);
const { killed, cleared, staleLocks } = s.recovery;
if (cleared || staleLocks) console.log(`Recovery: cleared ${cleared} running record(s), ${staleLocks} stale lock(s), killed ${killed} orphaned browser(s)`);
if (s.reencrypted) console.log(`Re-encrypted ${s.reencrypted} proxy secret(s)`);
let closing = false;
const shutdown = async () => { if (closing) return; closing = true; await s.close(); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
