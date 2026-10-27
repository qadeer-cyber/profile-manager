// Adapter failures are unit-tested with protocol stubs. Runtime evidence is in
// regional-locale-browser.test.js, which always launches genuine Chromium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { installRegionalLocale } from '../server/regional-locale.js';

test('missing pinned session adapter fails explicitly and detaches root', async () => {
  let detached = false;
  const root = { detach: async () => { detached = true; } };
  await assert.rejects(installRegionalLocale({ browser: () => ({ newBrowserCDPSession: async () => root }) }, 'fr-FR'), /pinned Playwright/);
  assert.equal(detached, true);
});

function fixture({ initialError, duplicateMatches = false } = {}) {
  const root = new EventEmitter(), context = new EventEmitter(), calls = [];
  const children = new Map();
  const parent = Object.assign(new EventEmitter(), {
    createChildSession: id => {
      const child = new EventEmitter();
      child.send = async (method, params) => {
        calls.push({ id, method, params });
        if (method === 'Emulation.setLocaleOverride' && initialError) throw initialError;
        if (method === 'Runtime.evaluate') return { result: { value: { actual: duplicateMatches ? 'fr-FR' : 'en-US', expected: 'fr-FR' } } };
      };
      children.set(id, child); return child;
    },
    disposeChildSession: id => { children.delete(id); },
  });
  root._connection = { toImpl: () => ({ _session: parent }) };
  root.send = async method => {
    if (method === 'Target.setAutoAttach') parent.emit('Target.attachedToTarget', { sessionId: 'initial' });
  };
  context.browser = () => ({ newBrowserCDPSession: async () => root });
  context.close = async () => { context.emit('close'); };
  return { root, parent, context, calls, children, fail: error => { initialError = error; } };
}
test('native setup failure is not resumed or silently marked configured', async () => {
  const f = fixture({ initialError: new Error('Unsupported protocol method') });
  await assert.rejects(installRegionalLocale(f.context, 'fr-FR'), /Failed to apply/);
  assert.ok(!f.calls.some(c => c.method === 'Runtime.runIfWaitingForDebugger'));
  await f.context.close(); assert.equal(f.children.size, 0);
});
test('shared-renderer override is accepted only after checking the native value', async () => {
  const error = new Error('Another locale override is already in effect');
  const wrong = fixture({ initialError: error });
  await assert.rejects(installRegionalLocale(wrong.context, 'fr-FR'), /Failed to apply/);
  await wrong.context.close();
  const correct = fixture({ initialError: error, duplicateMatches: true });
  await installRegionalLocale(correct.context, 'fr-FR');
  assert.ok(correct.calls.some(c => c.method === 'Runtime.evaluate'));
  assert.ok(correct.calls.some(c => c.method === 'Runtime.runIfWaitingForDebugger'));
  await correct.context.close(); assert.equal(correct.children.size, 0);
});

test('late target setup failure closes the context, reports once and resumes no invalid target', async () => {
  const f = fixture();
  let notifications = 0, resolveFailure;
  const reported = new Promise(resolve => { resolveFailure = resolve; });
  await installRegionalLocale(f.context, 'fr-FR', { onFailure: error => { notifications++; resolveFailure(error); } });
  f.fail(new Error('Native locale failed'));
  f.parent.emit('Target.attachedToTarget', { sessionId: 'late' });
  const error = await reported;
  assert.match(error.message, /Failed to apply/);
  assert.equal(notifications, 1); assert.equal(f.children.size, 0);
  assert.ok(!f.calls.some(c => c.id === 'late' && c.method === 'Runtime.runIfWaitingForDebugger'));
});
