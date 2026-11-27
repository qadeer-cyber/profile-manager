// Bulk create preview (web/src/lib/bulkCreate.js): same parser, names and duplicate rule as the server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planBulkCreate, remainingLines } from '../web/src/lib/bulkCreate.js';

test('each non-blank line is one row with its profile name; blank lines are skipped', () => {
  const plan = planBulkCreate({ text: '203.0.113.1:8000:u:p\n\n  \nsocks5://203.0.113.2:1080\r\n203.0.113.3:9000', pattern: 'Shop {n}', startAt: 10 });
  assert.deepEqual(plan.rows.map(r => r.name), ['Shop 10', 'Shop 11', 'Shop 12']);
  assert.equal(plan.counts.ok, 3);
  assert.equal(plan.canCreate, true);
  assert.equal(plan.rows[1].label.startsWith('socks5://203.0.113.2:1080'), true);
  assert.equal(plan.rows[0].label.startsWith('http://'), true, 'the type for lines without a scheme applies');
  assert.equal(planBulkCreate({ text: '203.0.113.3:9000', defaultType: 'socks5' }).rows[0].label.startsWith('socks5://'), true);
});

test('passwords never appear in a row', () => {
  const plan = planBulkCreate({ text: '203.0.113.1:8000:alice:Sup3rSecret\nsocks5://bob:Another%40Pw@203.0.113.2:1080' });
  const shown = JSON.stringify(plan.rows.map(r => ({ label: r.label, message: r.message, name: r.name })));
  assert.ok(!shown.includes('Sup3rSecret') && !shown.includes('Another'));
  assert.match(plan.rows[0].label, /alice · password set/);
});

test('bad lines and repeated proxies are marked, counted, and do not block the rest', () => {
  const plan = planBulkCreate({ text: '203.0.113.1:8000:u:a\nnot a proxy\n203.0.113.1:8000:u:b\n203.0.113.2:80' });
  assert.deepEqual(plan.rows.map(r => r.state), ['ok', 'invalid', 'duplicate', 'ok']);
  assert.deepEqual(plan.counts, { total: 4, ok: 2, invalid: 1, duplicate: 1 });
  assert.equal(plan.summary, '2 profiles ready · 1 line not understood · 1 repeated');
  assert.equal(plan.canCreate, true);
});

test('empty, all-bad and over-limit input cannot be created', () => {
  assert.equal(planBulkCreate({ text: '' }).canCreate, false);
  assert.equal(planBulkCreate({ text: '' }).summary, 'Paste one proxy per line.');
  assert.equal(planBulkCreate({ text: 'nope\nnope2' }).canCreate, false);
  const many = planBulkCreate({ text: Array.from({ length: 101 }, (_, i) => `203.0.${Math.floor(i / 250)}.${i % 250 + 1}:80`).join('\n') });
  assert.equal(many.tooMany, true); assert.equal(many.canCreate, false); assert.match(many.summary, /Too many lines: 101/);
});

test('after a run only the failed lines remain', () => {
  const rows = planBulkCreate({ text: 'a.example:1\nb.example:2\nc.example:3' }).rows;
  assert.deepEqual(remainingLines(rows, [{ index: 0, ok: true }, { index: 1, ok: false }, { index: 2, ok: true }]), ['b.example:2']);
  assert.deepEqual(remainingLines(rows, [{ index: 0, ok: true }]), []);
});

test('remaining lines follow the position in what was sent, even when earlier preview rows were skipped', () => {
  const plan = planBulkCreate({ text: 'bad line\na.example:1\nb.example:2' });
  const sent = plan.rows.filter(r => r.state === 'ok');
  assert.deepEqual(remainingLines(sent, [{ index: 0, ok: true }, { index: 1, ok: false }]), ['b.example:2']);
});
