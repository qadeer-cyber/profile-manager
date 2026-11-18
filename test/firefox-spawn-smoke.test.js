import './_isolated-data.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolveFirefoxExecutable } from '../server/browser-runtime/firefox-launch.js';

test('firefox spawn smoke when host Firefox is installed', { timeout: 30000 }, async t => {
  const exe = resolveFirefoxExecutable();
  if (!exe) {
    t.skip('No installed Firefox executable; real-host qualification is pending');
    return;
  }
  const args = process.platform === 'win32' ? ['-v'] : ['--version'];
  const code = await new Promise((resolve, reject) => {
    const proc = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { if (proc.exitCode === null && proc.signalCode === null) proc.kill(); });
    let out = '';
    proc.stdout?.on('data', d => { out += d; });
    proc.stderr?.on('data', d => { out += d; });
    proc.on('error', reject);
    proc.on('exit', (c) => resolve(c === 0 || out.toLowerCase().includes('mozilla') ? 0 : c ?? 1));
  });
  assert.equal(code, 0);
});
