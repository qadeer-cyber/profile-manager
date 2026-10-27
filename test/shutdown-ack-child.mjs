// Test-only entry. Patches better-sqlite3 before server/index.js opens the database so a
// shutdown can be forced to fail at wal_checkpoint or db.close without changing production.
import Database from 'better-sqlite3';

if (process.env.PM_TEST_FAIL_DB_CLOSE === '1') {
  Database.prototype.close = function failDbClose() {
    throw new Error('db.close failed');
  };
}

if (process.env.PM_TEST_FAIL_WAL_CHECKPOINT === '1') {
  const pragma = Database.prototype.pragma;
  let armed = false;
  // Registered before server/index.js, so this runs first and arms the failure
  // before shutdown() reaches the checkpoint. Startup checkpoints stay real.
  process.on('message', m => {
    if (m === 'shutdown' || (m && typeof m === 'object' && m.type === 'shutdown')) armed = true;
  });
  Database.prototype.pragma = function (source, options) {
    if (armed && typeof source === 'string' && source.includes('wal_checkpoint')) {
      throw new Error('wal_checkpoint failed');
    }
    return pragma.call(this, source, options);
  };
}

await import('../server/index.js');
