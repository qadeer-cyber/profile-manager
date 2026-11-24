// Part 5: opt-in canvas readback protection. The Chromium patch is checked structurally here; its behaviour is
// verified in Windows CI against a built browser (docs/privacy-threat-model.md, canvas gate D).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const patch = fs.readFileSync(new URL('../native-chromium/canvas-noise.patch', import.meta.url), 'utf8');
const launcher = fs.readFileSync(new URL('../server/browser-runtime/azwah-native.js', import.meta.url), 'utf8');

test('the canvas patch is a full-index, additions-only change to four known files', () => {
  assert.doesNotMatch(patch, /\r/);
  const files = [...patch.matchAll(/^diff --git a\/(\S+) b\/\1\nindex [0-9a-f]{40}\.\.[0-9a-f]{40} 100644$/gm)].map(m => m[1]);
  assert.deepEqual(files.sort(), [
    'content/browser/renderer_host/render_process_host_impl.cc',
    'third_party/blink/renderer/core/html/canvas/html_canvas_element.cc',
    'third_party/blink/renderer/core/html/canvas/html_canvas_element.h',
    'third_party/blink/renderer/modules/canvas/canvas2d/base_rendering_context_2d.cc',
  ]);
  assert.equal([...patch.matchAll(/^diff --git /gm)].length, 4);
  const removed = patch.split('\n').filter(line => line.startsWith('-') && !line.startsWith('---'));
  assert.deepEqual(removed, [], 'no upstream line is removed');
});

test('the canvas patch is original code, keeps the sandbox, and changes only readbacks', () => {
  const added = patch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).join('\n');
  assert.doesNotMatch(added, /\bbrave\b|farbl|Mozilla Public License|\bMPL\b/i);
  assert.doesNotMatch(added, /no-sandbox|NoSandbox/);
  assert.match(added, /"azwah-canvas-seed"/);
  assert.match(added, /source_buffer == kBackBuffer/, 'toDataURL only for script readback, not the displayed buffer');
  assert.match(added, /AzwahApplyCanvasNoise\(\s*\+?\s*image_data_pixmap/, 'getImageData');
});

test('AZWAH passes a fresh secret only when the profile opts in, and refuses a build without the patch', () => {
  assert.match(launcher, /canvasReadback === 'prototype'/);
  assert.match(launcher, /AZWAH_NATIVE_CANVAS_UNSUPPORTED/);
  assert.match(launcher, /if \(canvasProtection\) args\.push\(`--azwah-canvas-seed=\$\{randomUUID\(\)/);
  assert.match(launcher, /canvasPatchSha256/);
});
