// Compatibility baseline (needs a Playwright Chromium; run with `npm run test:compat`). On an unmodified browser
// every check passes and the canvas/audio hashes are identical across loads; that stability is what lets a later
// privacy protection's effect be measured. Local evidence about the browser it ran on, nothing more.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCompat } from '../scripts/compat-baseline.mjs';

test('unmodified browser: every compatibility check passes and hashes are stable across loads', { timeout: 120000 }, async () => {
  const a = await runCompat();
  const b = await runCompat();
  assert.equal(a.ok, true, JSON.stringify(a.results));
  assert.equal(b.ok, true, JSON.stringify(b.results));
  assert.equal(a.results.canvas.hash, b.results.canvas.hash, 'canvas readback is deterministic without protection');
  assert.equal(a.results.audio.hash, b.results.audio.hash, 'audio render is deterministic without protection');
  console.log(`# baseline ${a.browser} ${a.platform} canvas=${a.results.canvas.hash.slice(0, 12)} audio=${a.results.audio.hash.slice(0, 12)}`);
});
