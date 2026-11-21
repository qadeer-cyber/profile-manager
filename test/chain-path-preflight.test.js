// Path preflight for the Chromium chain (run 44798415536 stage 2 failed on an object path of exactly 260).
// Uses the real failing object name; no Chromium checkout is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { checkPaths, outputsFromTargets } from '../scripts/chain-path-preflight.mjs';

const XNN = 'obj/third_party/xnnpack/f16-igemm_f16c-fma-avx512f-avx512cd-avx512bw-avx512dq-avx512vl-avx512vnni-gfni-avx512fp16-amx-tile-amx-int8-amx-fp16/f16-igemm-16x64c2-minmax-avx512amxfp16.obj';
const SIBLING = XNN.replace('16x64c2', '1x64c2');
const targets = [`${XNN}: cc`, `${SIBLING}: cc`, 'obj/base/base/values.obj: cxx', 'chrome.exe: link', 'all: phony', '', 'garbage line without rule'].join('\n');
const OLD = 'D:\\azwah-chain-44798415536-stage-2\\chromium\\src\\out\\azwah-native-development';
const NEW = 'D:\\az\\c\\src\\out\\azwah-native-development';

test('the real failing object measures 260 under the old workspace and fails the preflight', () => {
  const r = checkPaths(targets, OLD);
  assert.equal(r.longest.length, 260);
  assert.equal(r.longest.path, XNN);
  assert.equal(r.ok, false);
  assert.match(r.reason, /260 characters/);
  assert.equal(checkPaths(`${SIBLING}: cc`, OLD).longest.length, 259, 'the sibling that succeeded in CI');
});

test('the short workspace brings it to 224 and passes', () => {
  const r = checkPaths(targets, NEW);
  assert.equal(r.longest.length, 224);
  assert.equal(r.ok, true);
});

test('the limit is inclusive and adjustable', () => {
  assert.equal(checkPaths(targets, NEW, 224).ok, true);
  assert.equal(checkPaths(targets, NEW, 223).ok, false);
});

test('outputs are parsed from ninja -t targets lines; malformed lines are ignored', () => {
  assert.deepEqual(outputsFromTargets(targets), [XNN, SIBLING, 'obj/base/base/values.obj', 'chrome.exe', 'all']);
});

test('fails closed on an empty target list or a relative build directory', () => {
  assert.equal(checkPaths('', NEW).ok, false);
  assert.equal(checkPaths('ninja: error: loading build.ninja', NEW).ok, false);
  assert.throws(() => checkPaths(targets, 'out/x'), /absolute Windows path/);
});

test('command line: prints LONGEST_OUTPUT_PATH and exits 1 when too long', () => {
  const script = new URL('../scripts/chain-path-preflight.mjs', import.meta.url).pathname;
  const bad = spawnSync(process.execPath, [script, OLD], { input: targets, encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /^LONGEST_OUTPUT_PATH length=260 /m);
  const good = spawnSync(process.execPath, [script, NEW], { input: targets, encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /PATH_PREFLIGHT outputs=5 ok=true/);
  const empty = spawnSync(process.execPath, [script, NEW], { input: '', encoding: 'utf8' });
  assert.equal(empty.status, 1);
});
