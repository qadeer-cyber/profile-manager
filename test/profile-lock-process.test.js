import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireLock, releaseLock, readLock, LOCK_NAME } from '../server/lock.js';

test('independent processes contest a stale lock; delayed operations cannot change its successor', { timeout: 15000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azwah-lock-'));
  const children = [];
  t.after(async () => {
    await Promise.all(children.map(async child => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(dir, LOCK_NAME), '{broken');
  for (let i = 0; i < 3; i++) {
    const child = fork(new URL('./fixtures/profile-lock-worker.mjs', import.meta.url), [dir], { execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    children.push(child);
    await once(child, 'message');
  }
  const command = async (child, msg) => {
    const reply = once(child, 'message');
    child.send(msg);
    return (await reply)[0];
  };
  const results = await Promise.all(children.map(child => command(child, 'acquire')));
  assert.equal(results.filter(r => r === 'held').length, 1);
  assert.equal(results.filter(r => r === 409).length, 2);
  const winner = children[results.indexOf('held')];
  await command(winner, 'release');
  acquireLock(dir);
  const successor = readLock(dir);
  await command(winner, 'late');
  assert.deepEqual(readLock(dir), successor);
  releaseLock(dir);
  await command(winner, 'late');
  assert.equal(readLock(dir), null);
});
