import assert from 'node:assert/strict';
import test from 'node:test';
import { dedicatedExtensionIssue } from '../engine-prototype/extension-policy.js';

test('dedicated extensions support narrow MV3 content scripts and local storage', () => {
  const manifest = { manifest_version: 3, name: 'Fixture', version: '1.0', permissions: ['storage'],
    content_scripts: [{ matches: ['https://example.org/*'], js: ['content.js'] }] };
  assert.equal(dedicatedExtensionIssue(manifest), null);
  assert.match(dedicatedExtensionIssue({ ...manifest, background: { service_worker: 'worker.js' } }), /background/);
  assert.match(dedicatedExtensionIssue({ ...manifest, permissions: ['proxy'] }), /storage/);
  assert.match(dedicatedExtensionIssue({ ...manifest, content_scripts: [{ world: 'MAIN' }] }), /isolated/);
  assert.match(dedicatedExtensionIssue({ ...manifest, manifest_version: 2 }), /Manifest V3/);
});
