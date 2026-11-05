import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cli-script-'));
process.env.PM_DATA_DIR = dir;
process.env.PM_API_TOKEN = 'cli-script-token';
const cli = path.join('scripts', 'pm-cli.mjs');
let server;
let baseUrl;

function runCli(args, { expect = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: {
        ...process.env,
        PM_API_BASE: `${baseUrl}/api/v1`,
        PM_UI_BASE: `${baseUrl}/api`,
        PM_API_TOKEN: 'cli-script-token',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`pm-cli ${args.join(' ')} timed out\nstderr:${stderr}\nstdout:${stdout}`));
    }, 15000);
    child.on('close', status => {
      clearTimeout(timer);
      if (status !== expect) reject(new Error(`pm-cli ${args.join(' ')} exit ${status}\nstderr:${stderr}\nstdout:${stdout}`));
      else resolve({ stdout, stderr, status });
    });
  });
}

before(async () => {
  const { startServer } = await import('../server/app.js');
  server = await startServer({ port: 0, staticDir: null, host: '127.0.0.1' });
  baseUrl = server.url.replace(/\/$/, '');
});

after(async () => {
  await server.close();
  try { const { db } = await import('../server/db.js'); db.close(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  delete process.env.PM_DATA_DIR;
  delete process.env.PM_API_TOKEN;
});

test('pm-cli run executes a JSON script and --json errors are JSON', async () => {
  const script = path.join(dir, 'create.json');
  fs.writeFileSync(script, JSON.stringify({
    name: 'create-and-show',
    steps: [
      { id: 'create', method: 'POST', path: '/profiles', body: { name: 'From script' }, save: 'profile' },
      { id: 'show', method: 'GET', path: '/profiles/{{profile.id}}' },
    ],
  }));
  const ok = await runCli(['--json', 'run', `@${script}`]);
  const body = JSON.parse(ok.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.results[1].body.name, 'From script');
  assert.equal(body.results[1].body.id, body.results[0].body.id);
  const bad = await runCli(['--json', 'not-a-command'], { expect: 2 });
  const err = JSON.parse(bad.stderr);
  assert.equal(err.ok, false);
  assert.match(err.error, /Unknown command/);
  const help = await runCli(['help']);
  assert.match(help.stdout, /\brun\b/);
  assert.match(help.stdout, /\bexec\b/);
});

test('pm-cli exec runs node without a shell and does not put the token on argv', async () => {
  const script = path.join(dir, 'argv-check.mjs');
  fs.writeFileSync(script, `console.log(JSON.stringify({ ok: true, argv: process.argv.slice(1), authorized: process.env.PM_SCRIPT_AUTHORIZED || null }));\n`);
  const result = await runCli(['--json', 'exec', script]);
  const wrapped = JSON.parse(result.stdout);
  assert.equal(wrapped.ok, true);
  const inner = JSON.parse(wrapped.stdout);
  assert.equal(inner.authorized, 'ui-testing');
  assert.equal(inner.argv.some(arg => String(arg).includes('cli-script-token')), false);
  assert.equal(result.stderr.includes('cli-script-token'), false);
});
