import './_isolated-data.mjs';
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

test('failed process termination preserves running row, profile lock and data until explicit retry succeeds', { timeout: 15000 }, async () => {
  const realProc = await import('../server/proc.js');
  let alive = true, attempts = 0, allowStop = false;
  const proc = Object.assign(new EventEmitter(), { pid: 424242, exitCode: null, signalCode: null });
  mock.module('../server/proc.js', { namedExports: { ...realProc,
    isAlive: pid => pid === proc.pid ? alive : realProc.isAlive(pid),
    pidMatches: async pid => pid === proc.pid,
    killTree: async pid => { assert.equal(pid, proc.pid); attempts++; if (allowStop) { alive = false; proc.exitCode = 0; proc.emit('exit', 0, null); } return !alive; },
  } });
  mock.module('../server/browser-runtime/launch-plan.js', { namedExports: { buildProfileLaunchPlan: async () => ({ runtime: 'native', args: [], plan: {}, regional: {}, relayUrl: null }) } });
  mock.module('../server/browser-runtime/native-chromium.js', { namedExports: { launchNativeChromium: async () => ({ proc, browserPid: proc.pid, spawnPid: proc.pid, argv: [] }) } });
  const { db, userDataDir } = await import('../server/db.js');
  const { launch, stop, isRunning } = await import('../server/browsers.js');
  const { readLock } = await import('../server/lock.js');
  const id = crypto.randomUUID(), now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (id,name,tags,folder,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, 'Disposable failed-stop fixture', '[]', '', '', now, now);
  const dir = userDataDir(id); fs.mkdirSync(dir, { recursive: true }); const marker = path.join(dir, 'retained-data'); fs.writeFileSync(marker, 'preserve');
  try {
    await launch({ id, proxy: null }, { automation: false });
    const results = await Promise.allSettled([stop(id, { timeoutMs: 50 }), stop(id, { timeoutMs: 50 })]);
    for (const result of results) { assert.equal(result.status, 'rejected'); assert.equal(result.reason.code, 'BROWSER_STOP_FAILED'); }
    assert.ok(attempts > 0); assert.equal(isRunning(id), true);
    assert.equal(db.prepare('SELECT pid FROM running WHERE id=?').get(id).pid, proc.pid);
    assert.equal(readLock(dir).browserPid, proc.pid); assert.equal(fs.readFileSync(marker, 'utf8'), 'preserve');
    assert.match(db.prepare('SELECT last_error FROM profiles WHERE id=?').get(id).last_error, /still running/);
    allowStop = true; await stop(id, { timeoutMs: 50 });
    assert.equal(isRunning(id), false); assert.equal(db.prepare('SELECT * FROM running WHERE id=?').get(id), undefined);
    assert.equal(readLock(dir), null); assert.equal(fs.readFileSync(marker, 'utf8'), 'preserve');
  } finally { allowStop = true; if (isRunning(id)) await stop(id); mock.restoreAll(); }
});
