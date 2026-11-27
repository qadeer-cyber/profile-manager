// The live probe pages are JavaScript inside JavaScript template strings, where an escape such as \r\n silently changes
// meaning (run 46038073852: a regex became "missing /" and the whole page failed to parse, so it never reported).
// This test builds each page exactly as the live test does and syntax-checks the script that the browser will receive.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Evaluate the part of a live test file that defines its page strings (everything before the first test() call).
function pageStrings(file, names) {
  const source = fs.readFileSync(new URL('../test/' + file, import.meta.url), 'utf8');
  const head = source.slice(0, source.indexOf('\ntest('));
  const code = head.replace(/^import .*$/gm, '') + `\n;globalThis.__out = { ${names.join(', ')} };`;
  const context = { process: { env: {}, platform: 'win32' }, globalThis: {} };
  context.globalThis = context;
  vm.runInNewContext(code, context);
  return context.__out;
}
const scriptOf = html => { const m = /<script>([\s\S]*)<\/script>/.exec(html); assert.ok(m, 'the page has a script'); return m[1]; };

test('fingerprint probe page: the script parses, awaits are inside an async function, and the watchdog is defined', () => {
  const { PAGE } = pageStrings('azwah-fingerprint-windows-live.test.js', ['PAGE']);
  const js = scriptOf(PAGE);
  assert.doesNotThrow(() => new vm.Script(js, { filename: 'fingerprint-probe-page.js' }));
  assert.match(js, /const watchdog = setTimeout/);
  assert.match(js, /const within = /);
  assert.ok(js.includes('split(/\\r?\\n/)'), 'the SDP line split keeps its backslashes (a bare \\r\\n becomes real line breaks inside the regex)');
});

test('worker probe: the page script, the shared probe and the worker script all parse', () => {
  const { PAGE, PROBE, WORKER_JS } = pageStrings('azwah-worker-windows-live.test.js', ['PAGE', 'PROBE', 'WORKER_JS']);
  assert.doesNotThrow(() => new vm.Script(scriptOf(PAGE), { filename: 'worker-probe-page.js' }));
  assert.doesNotThrow(() => new vm.Script(PROBE, { filename: 'worker-probe.js' }));
  assert.doesNotThrow(() => new vm.Script(WORKER_JS, { filename: 'worker.js' }));
  assert.match(scriptOf(PAGE), /const watchdog = setTimeout/);
});

test('the checker really catches the bug it was written for', () => {
  // Source text as it appears in a live test file, inside a template string: one backslash versus two.
  const oneBackslash = String.raw`a.split(/\r?\n/)`;
  const twoBackslashes = String.raw`a.split(/\\r?\\n/)`;
  const evaluate = sourceText => eval('`' + sourceText + '`'); // what the live test's PAGE string turns into
  assert.throws(() => new vm.Script(evaluate(oneBackslash)), /Invalid regular expression|missing \//, 'one backslash: real line breaks inside the regex');
  assert.doesNotThrow(() => new vm.Script(evaluate(twoBackslashes)), 'two backslashes: the regex survives');
});
