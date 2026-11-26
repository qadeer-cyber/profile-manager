// Bounded Ninja diagnostic filter (synthetic Ninja output in the documented formats; not CI evidence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterExplain, summarizeDeps, WATCHED, MAX_LINES } from '../scripts/chain-ninja-explain.mjs';

test('keeps only explain lines about watched objects, and counts the rest', () => {
  const text = [
    'ninja explain: deps for \'obj/base/base/atl_throw.obj\' are missing',
    'ninja explain: obj/base/base/atl_throw.obj is dirty',
    'ninja explain: output obj/v8/a.obj doesn\'t exist',
    '[1/2] CXX obj/base/base/atl_throw.obj',
    'unrelated',
  ].join('\n');
  const r = filterExplain(text);
  assert.equal(r.lines.length, 2);
  assert.equal(r.explainLinesSeen, 3);
  assert.deepEqual(r.watchedFound, ['obj/base/base/atl_throw.obj']);
});

test('output is capped so a full-graph dry run cannot flood the log', () => {
  const text = Array.from({ length: 5000 }, () => `ninja explain: ${WATCHED[1]} is dirty`).join('\n');
  const r = filterExplain(text);
  assert.equal(r.lines.length, MAX_LINES);
  assert.equal(r.explainLinesSeen, 5000);
});

test('deps records are summarised per watched object; missing ones are reported, not assumed', () => {
  const text = [
    'obj/base/base/atl_throw.obj: #deps 0, deps mtime 0 (STALE)',
    'obj/base/base/values.obj: #deps 412, deps mtime 1795183546 (VALID)',
    '    ../../base/values.h',
  ].join('\n');
  const s = summarizeDeps(text);
  assert.deepEqual(s['obj/base/base/atl_throw.obj'], { deps: 0, state: 'STALE' });
  assert.deepEqual(s['obj/base/base/values.obj'], { deps: 412, state: 'VALID' });
  assert.equal(s['obj/base/base/byte_size.obj'], 'not listed');
});
