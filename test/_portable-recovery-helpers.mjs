import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const worker = fileURLToPath(new URL('./fixtures/portable-recovery-worker.mjs', import.meta.url));
export const passphrase = 'disposable test passphrase';
export function sandbox(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-portable-recovery-')); t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })); return root; }
export function run(dir, args, expected = 0) {
  const env = { ...process.env, PM_DATA_DIR: dir, PM_TEST_ARGS: JSON.stringify(args) }; delete env.PM_SECRET; delete env.NODE_TEST_CONTEXT;
  const p = spawnSync(process.execPath, [worker], { env, encoding: 'utf8', timeout: 15000 });
  assert.equal(p.status, expected, p.stderr + p.stdout);
  return p.stdout.trim() ? JSON.parse(p.stdout.trim()) : null;
}
export function archive(t, engine = 'chromium') {
  const root = sandbox(t), a = path.join(root, 'A'), b = path.join(root, 'B'), file = path.join(root, 'portable.pmp');
  const ids = run(a, { mode: 'seed' }).value;
  assert.equal(run(a, { mode: 'export', engine, file }).value.encrypted, true);
  return { root, a, b, file, ids };
}
