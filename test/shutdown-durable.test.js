// Shared quit path: browser close, then WAL checkpoint, then db.close.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { checkpointAndClose, durableShutdown } from '../server/shutdown.js';

test('durable shutdown checkpoints and closes after the browsers stop', async () => {
  const steps = [];
  const db = {
    open: true,
    pragma(sql) { steps.push(sql); },
    close() { steps.push('close'); this.open = false; },
  };
  await durableShutdown({
    closeBrowsers: async () => { steps.push('browsers'); },
    db,
    log: () => { throw new Error('success path must not log'); },
  });
  assert.deepEqual(steps, ['browsers', 'wal_checkpoint(TRUNCATE)', 'close']);
  assert.equal(db.open, false);
  checkpointAndClose(db);
  assert.deepEqual(steps, ['browsers', 'wal_checkpoint(TRUNCATE)', 'close']);
});

test('a throwing checkpoint is logged and does not close the database', async () => {
  const logs = [];
  let closed = false;
  const db = {
    open: true,
    pragma() { throw new Error('wal_checkpoint failed'); },
    close() { closed = true; },
  };
  await assert.rejects(durableShutdown({
    closeBrowsers: async () => {},
    db,
    log: err => logs.push(err),
  }), /wal_checkpoint failed/);
  assert.equal(closed, false);
  assert.equal(logs.length, 1);
  assert.match(logs[0].message, /wal_checkpoint failed/);
});

test('the shutdown cap logs and rejects when browser close does not finish', async () => {
  const logs = [];
  await assert.rejects(durableShutdown({
    closeBrowsers: () => new Promise(() => {}),
    db: { open: true, pragma() { throw new Error('should not checkpoint'); }, close() { throw new Error('should not close'); } },
    timeoutMs: 30,
    log: err => logs.push(err),
  }), /Shutdown timed out after 30ms/);
  assert.equal(logs.length, 1);
  assert.match(logs[0].message, /Shutdown timed out after 30ms/);
});

test('electron before-quit is a one-shot literal-import shutdown', () => {
  const src = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const handler = src.slice(src.indexOf("app.on('before-quit'"));
  const guard = handler.indexOf('quitStarted = true');
  const prevent = handler.indexOf('e.preventDefault()');
  assert.ok(guard > 0 && prevent > guard, 'the first before-quit sets the guard and then preventDefault');
  assert.match(src, /await import\('\.\.\/server\/db\.js'\)/);
  assert.match(src, /await import\('\.\/offline-smoke\.js'\)/);
  assert.equal(/import\([^)'"]*process\.env/.test(src), false);
  assert.match(src, /PM_SMOKE === '1' && process\.env\.PM_SMOKE_OFFLINE === '1'/);
  const offline = fs.readFileSync(new URL('../electron/offline-smoke.js', import.meta.url), 'utf8');
  const phases = fs.readFileSync(new URL('../electron/smoke-phases.js', import.meta.url), 'utf8');
  const flag = offline.indexOf("process.env.PM_SMOKE !== '1' || process.env.PM_SMOKE_OFFLINE !== '1'");
  const go = offline.indexOf('await dispatchSmokePhase');
  assert.ok(flag >= 0 && go > flag, 'phase dispatch runs only after both smoke flags are checked');
  assert.ok(phases.includes("'/api/profiles'"), 'profile creation stays in the phase handlers');
  assert.equal(offline.includes('PRIVATE KEY'), false);
  assert.equal(phases.includes('PRIVATE KEY'), false);
  assert.equal(/import\([^)'"]*process\.env/.test(offline), false);
  assert.equal(/import\([^)'"]*process\.env/.test(phases), false);
});
