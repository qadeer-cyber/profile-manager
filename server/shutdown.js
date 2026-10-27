// One database close for the CLI IPC shutdown and the Electron before-quit path.
// A second call is a no-op once the handle is closed.

export function checkpointAndClose(db) {
  if (!db?.open) return;
  db.pragma('wal_checkpoint(TRUNCATE)');
  if (!db.open) return;
  db.close();
}

// Browser close, then WAL checkpoint, then db.close. The whole sequence is capped
// by timeoutMs. Failures and the timeout are logged and rethrown — not swallowed.
export async function durableShutdown({ closeBrowsers, db, timeoutMs = 10000, log = console.error }) {
  let timer;
  let raced = false;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Shutdown timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  const work = (async () => {
    await closeBrowsers();
    checkpointAndClose(db);
  })();
  // Attached before Promise.race, so a rejection during the race is logged once
  // from the catch below. A rejection that arrives after the cap fired is logged here.
  work.catch(err => { if (raced) log(err); });
  try {
    await Promise.race([work, timeout]);
  } catch (err) {
    raced = true;
    log(err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
