// A failed wal_checkpoint or db.close must not send shutdown-done, and the harness
// must count that as a failed graceful shutdown.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import { stopServer, hardKill, missedGracefulShutdowns } from './_ports.mjs';

const childScript = fileURLToPath(new URL('./shutdown-ack-child.mjs', import.meta.url));

function startFailedServer(env) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-shutdown-ack-'));
  const proc = fork(childScript, [], {
    execArgv: [],
    env: { ...process.env, PORT: '0', PM_DATA_DIR: data, ...env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  proc.out = '';
  proc.err = '';
  proc.stdout.on('data', d => { proc.out += d; });
  proc.stderr.on('data', d => { proc.err += d; });
  const messages = [];
  proc.on('message', m => messages.push(m));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      hardKill(proc.pid);
      reject(new Error('server start timeout\n' + proc.out + '\n' + proc.err));
    }, 20000);
    proc.stdout.on('data', () => {
      if (!/Profile manager on http:\/\//.test(proc.out)) return;
      clearTimeout(timer);
      proc.removeAllListeners('exit');
      resolve({ proc, data, messages });
    });
    proc.once('exit', code => {
      clearTimeout(timer);
      reject(new Error('server exited before start: ' + code + '\n' + proc.out + '\n' + proc.err));
    });
  });
}

async function expectNoAck(env, logged) {
  const before = missedGracefulShutdowns();
  const started = await startFailedServer(env);
  try {
    const messages = [];
    started.proc.on('message', m => messages.push(m));
    const graceful = await stopServer(started.proc, { timeoutMs: 8000 });
    assert.equal(graceful, false);
    assert.equal(started.proc.exitCode, 1);
    assert.equal(messages.some(m => m && m.type === 'shutdown-done'), false);
    assert.equal(missedGracefulShutdowns(), before + 1);
    assert.match(started.proc.err, logged);
  } finally {
    if (started.proc.exitCode === null) hardKill(started.proc.pid);
    fs.rmSync(started.data, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

describe('shutdown ack requires a clean database close', { concurrency: false }, () => {
  test('failed db.close sends no shutdown-done and fails the harness', async () => {
    await expectNoAck({ PM_TEST_FAIL_DB_CLOSE: '1' }, /db\.close failed/);
  });
  test('failed wal_checkpoint sends no shutdown-done and fails the harness', async () => {
    await expectNoAck({ PM_TEST_FAIL_WAL_CHECKPOINT: '1' }, /wal_checkpoint failed/);
  });
});
