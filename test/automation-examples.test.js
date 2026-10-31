import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { assertLoopbackEndpoint } from '../examples/cdp-guard.mjs';

test('CDP examples accept loopback and refuse anything else', () => {
  assert.equal(assertLoopbackEndpoint('ws://127.0.0.1:9222/devtools/browser/abc').hostname, '127.0.0.1');
  assert.equal(assertLoopbackEndpoint('http://localhost:9222/json/version').hostname, 'localhost');
  assert.throws(() => assertLoopbackEndpoint('ws://10.1.2.3:9222/devtools/browser/abc'), /loopback/);
  assert.throws(() => assertLoopbackEndpoint('not a url'), /URL/);
});

test('node and python examples exit before connecting when credentials are absent', () => {
  const env = { ...process.env, PM_API_TOKEN: '', PROFILE_ID: '' };
  const node = spawnSync(process.execPath, ['examples/playwright-cdp.mjs'], { encoding: 'utf8', env });
  assert.equal(node.status, 2);
  assert.match(node.stderr, /opt-in/);
  const python = spawnSync('python3', ['examples/playwright-connect.py'], { encoding: 'utf8', env });
  assert.equal(python.status, 2);
  assert.match(python.stderr, /loopback/);
  const compiled = spawnSync('python3', ['-m', 'py_compile', 'examples/playwright-connect.py'], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr);
});
