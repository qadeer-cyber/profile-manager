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

test('identity patch: additions only, four known files, switches passed to renderers', () => {
  const identity = fs.readFileSync(new URL('../native-chromium/identity.patch', import.meta.url), 'utf8');
  const files = [...identity.matchAll(/^diff --git a\/(\S+) b\/\1\nindex [0-9a-f]{40}\.\.[0-9a-f]{40} 100644$/gm)].map(m => m[1]).sort();
  assert.deepEqual(files, [
    'content/browser/renderer_host/render_process_host_impl.cc',
    'third_party/blink/renderer/core/frame/navigator_concurrent_hardware.cc',
    'third_party/blink/renderer/core/frame/navigator_device_memory.cc',
    'third_party/blink/renderer/modules/webgl/webgl_rendering_context_base.cc',
  ]);
  assert.deepEqual(identity.split('\n').filter(l => l.startsWith('-') && !l.startsWith('---')), []);
  for (const s of ['azwah-device-memory', 'azwah-hardware-concurrency', 'azwah-webgl-renderer', 'azwah-webgl-vendor']) assert.ok(identity.includes(`+      "${s}",`), s);
});

test('per-profile identity is stable for a profile, differs between profiles and stays within real values', async () => {
  const { nativeIdentityFor, nativeIdentityArgs, WINDOWS_GPUS } = await import('../server/browser-runtime/native-identity.js');
  assert.deepEqual(nativeIdentityFor('profile-a'), nativeIdentityFor('profile-a'));
  const many = Array.from({ length: 40 }, (_, i) => nativeIdentityFor('p' + i));
  assert.ok(new Set(many.map(x => JSON.stringify(x))).size > 10, 'profiles differ');
  for (const x of many) {
    assert.ok([4, 6, 8, 12, 16].includes(x.hardwareConcurrency));
    assert.ok([4, 8].includes(x.deviceMemory));
    assert.ok(WINDOWS_GPUS.some(([v, r]) => v === x.webglVendor && r === x.webglRenderer));
  }
  const args = nativeIdentityArgs(nativeIdentityFor('profile-a'));
  assert.equal(args.length, 4);
  assert.ok(args.every(a => a.startsWith('--azwah-')));
});

test('hardware identity setting: stored only when on, refused values rejected, launcher refuses a build without it', async () => {
  const { validateAdvancedSettings } = await import('../server/advanced-settings.js');
  assert.equal(validateAdvancedSettings({ experimental: { hardwareIdentity: 'prototype' } }).experimental.hardwareIdentity, 'prototype');
  assert.equal('hardwareIdentity' in validateAdvancedSettings({ experimental: { hardwareIdentity: 'off' } }).experimental, false);
  assert.throws(() => validateAdvancedSettings({ experimental: { hardwareIdentity: 'yes' } }));
  assert.match(launcher, /AZWAH_NATIVE_IDENTITY_UNSUPPORTED/);
  assert.match(launcher, /identityPatchSha256/);
});

test('AZWAH Chromium proxy profiles never send WebRTC UDP outside the proxy', () => {
  assert.match(launcher, /proxy \? chromiumPolicyArgs\(\{ mode: 'disable_non_proxied_udp' \}\)/);
  assert.match(launcher, /args\.push\(\.\.\.webrtcArgs\)/);
});

test('audio-screen patch: additions only, four known files, audio once per buffer, screen bounded', () => {
  const p = fs.readFileSync(new URL('../native-chromium/audio-screen.patch', import.meta.url), 'utf8');
  const files = [...p.matchAll(/^diff --git a\/(\S+) b\/\1\nindex [0-9a-f]{40}\.\.[0-9a-f]{40} 100644$/gm)].map(m => m[1]).sort();
  assert.deepEqual(files, [
    'content/browser/renderer_host/render_process_host_impl.cc',
    'third_party/blink/renderer/core/frame/screen.cc',
    'third_party/blink/renderer/modules/webaudio/audio_buffer.cc',
    'third_party/blink/renderer/modules/webaudio/audio_buffer.h',
  ]);
  assert.deepEqual(p.split('\n').filter(l => l.startsWith('-') && !l.startsWith('---')), []);
  assert.match(p, /\+  bool azwah_audio_noised_ = false;/);
  assert.match(p, /azwah_width >= 800 && azwah_width <= 7680/);
  assert.match(launcher, /AZWAH_NATIVE_AUDIO_UNSUPPORTED/);
});

test('gpu-fonts patch: known files, font list only for named families, WebGPU follows the identity', async () => {
  const p = fs.readFileSync(new URL('../native-chromium/gpu-fonts.patch', import.meta.url), 'utf8');
  const files = [...p.matchAll(/^diff --git a\/(\S+) b\/\1\nindex [0-9a-f]{40}\.\.[0-9a-f]{40} 100644$/gm)].map(m => m[1]).sort();
  assert.deepEqual(files, [
    'content/browser/renderer_host/render_process_host_impl.cc',
    'third_party/blink/renderer/modules/webgpu/gpu_adapter_info.cc',
    'third_party/blink/renderer/platform/fonts/font_cache.cc',
  ]);
  const removed = p.split('\n').filter(l => l.startsWith('-') && !l.startsWith('---'));
  assert.deepEqual(removed, ['-      power_preference_(power_preference) {}'], 'only the empty constructor body is replaced');
  assert.match(p, /creation_params\.Family\(\) != font_family_names::kSystemUi/);
  const { nativeIdentityFor, nativeIdentityArgs, WINDOWS_BASE_FONTS } = await import('../server/browser-runtime/native-identity.js');
  const id = nativeIdentityFor('fonts-profile');
  for (const font of WINDOWS_BASE_FONTS) assert.ok(id.fonts.includes(font), font);
  assert.ok(['nvidia', 'intel', 'amd'].includes(id.webgpuVendor));
  assert.ok(id.webglVendor.toLowerCase().includes(id.webgpuVendor), 'WebGPU and WebGL name the same vendor');
  const args = nativeIdentityArgs(id, { screen: true, gpuFonts: true });
  assert.ok(args.some(a => a.startsWith('--azwah-font-allowlist=arial,')));
  assert.equal(nativeIdentityArgs(id).length, 4, 'older builds get only the original four switches');
});
