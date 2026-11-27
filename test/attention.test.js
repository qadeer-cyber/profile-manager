// Attention banner model (web/src/lib/attention.js) and the meta count it reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { attentionItems, attentionSignature, bannerVisible } from '../web/src/lib/attention.js';
import { spawnServer, stopServer } from './_ports.mjs';

test('nothing to report means no banner', () => {
  assert.deepEqual(attentionItems({}), []);
  assert.deepEqual(attentionItems({ errorCount: 0, recoveryPendingCount: 0 }), []);
  assert.equal(bannerVisible([], ''), false);
});

test('interrupted data operations come first, with plural text and a Diagnostics action; errors open the filtered table', () => {
  const items = attentionItems({ errorCount: 3, recoveryPendingCount: 2 });
  assert.deepEqual(items.map(i => [i.id, i.action]), [['recovery', 'diagnostics'], ['errors', 'show-errors']]);
  assert.match(items[0].text, /^2 interrupted data operations need your decision/);
  assert.match(items[1].text, /^3 profiles stopped with an error/);
  assert.match(attentionItems({ recoveryPendingCount: 1 })[0].text, /^An interrupted data operation needs/);
  assert.match(attentionItems({ errorCount: 1 })[0].text, /^A profile stopped with an error/);
  assert.match(items[0].detail, /Nothing is deleted or retried automatically/);
});

test('a dismissed banner stays hidden until the counts change', () => {
  const one = attentionItems({ errorCount: 1 });
  const sig = attentionSignature(one);
  assert.equal(bannerVisible(one, sig), false);
  assert.equal(bannerVisible(attentionItems({ errorCount: 2 }), sig), true, 'one more error brings it back');
  assert.equal(bannerVisible(attentionItems({ errorCount: 1, recoveryPendingCount: 1 }), sig), true, 'a new kind of problem brings it back');
  assert.equal(bannerVisible(one, ''), true);
});

test('API: meta reports recoveryPendingCount (0 on a clean install)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-attention-'));
  const proc = await spawnServer({ ...process.env, PM_DATA_DIR: dir, PM_API_TOKEN: 'at' });
  try {
    const meta = await fetch(proc.url + '/api/meta', { headers: { Authorization: 'Bearer at' } }).then(r => r.json());
    assert.equal(meta.recoveryPendingCount, 0);
    assert.equal(meta.errorCount, 0);
  } finally {
    await stopServer(proc);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
