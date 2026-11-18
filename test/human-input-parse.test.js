import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHumanInputSegments, cancelHumanInput, humanInputReport, SPECIAL_KEY_NAMES,
} from '../server/human-input.js';

test('parseHumanInputSegments handles Unicode and special keys', () => {
  const segs = parseHumanInputSegments('café {Enter}🎹');
  assert.ok(segs.some(s => s.value === 'é'));
  assert.ok(segs.some(s => s.type === 'key' && s.value === 'Enter'));
  assert.ok(segs.some(s => s.value === '🎹'));
});

test('parseHumanInputSegments ignores unknown brace tokens as literal chars', () => {
  const segs = parseHumanInputSegments('{NotAKey}');
  assert.ok(segs.every(s => s.type === 'char'));
});

test('cancelHumanInput when idle returns not cancelled', () => {
  assert.equal(cancelHumanInput('00000000-0000-4000-8000-000000000099').cancelled, false);
});

test('humanInputReport documents engines and cancel endpoint', () => {
  const r = humanInputReport();
  assert.ok(r.supportedEngines.includes('chromium'));
  assert.ok(r.supportedEngines.includes('firefox'));
  assert.ok(r.cancelEndpoint.includes('cancel'));
  assert.equal(SPECIAL_KEY_NAMES.includes('Enter'), true);
});
