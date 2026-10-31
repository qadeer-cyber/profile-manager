import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimingSchedule, humanInputReport, TIMING_MODEL } from '../server/human-input.js';

test('inter-key schedule is stable and slows punctuation', () => {
  const a = buildTimingSchedule('hi.', { wpm: 120, deterministic: true });
  const b = buildTimingSchedule('hi.', { wpm: 120, deterministic: true });
  assert.deepEqual(a, b);
  assert.equal(a.model, TIMING_MODEL);
  assert.equal(a.intervalsMs.length, 3);
  assert.ok(a.intervalsMs[1] < a.intervalsMs[0]);
  assert.ok(a.intervalsMs[2] > a.intervalsMs[0]);
});

test('human input report keeps Firefox timing unmeasured', () => {
  const report = humanInputReport();
  assert.equal(report.firefox.timingMeasured, false);
  assert.deepEqual(report.timingMeasuredEngines, ['chromium']);
  assert.ok(report.firefox.limits.some(line => /not read back/i.test(line)));
  assert.match(report.note, /not a CAPTCHA/i);
});
