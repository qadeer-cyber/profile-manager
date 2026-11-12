import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectUpdate, createUpdateChecker } from '../electron/release-updates.js';
function release(version, fields = {}) {
  const tag = 'azwah-v' + version;
  return { tag_name: tag, draft: false, prerelease: version.includes('-beta.'), ...fields,
    assets: [{ name: 'Azwah-Setup-x64.exe', state: 'uploaded', size: 100, digest: 'sha256:' + 'a'.repeat(64),
      browser_download_url: 'https://github.com/qadeer-cyber/profile-manager/releases/download/' + tag + '/Azwah-Setup-x64.exe' }] };
}
test('stable ignores betas; beta compares numeric prerelease versions', () => {
  assert.equal(selectUpdate([release('0.5.0-beta.9'), release('0.5.0-beta.10')], '0.5.0-beta.1', 'beta').version, '0.5.0-beta.10');
  assert.equal(selectUpdate([release('0.6.0-beta.1'), release('0.5.1')], '0.5.0', 'stable').version, '0.5.1');
});
test('rejects downgrade, draft, channel mismatch, unrelated releases and invalid asset metadata', () => {
  const wrongAsset = release('0.7.0');
  wrongAsset.assets[0].browser_download_url = 'https://example.test/Azwah-Setup-x64.exe';
  const wrongDigest = release('0.8.0');
  wrongDigest.assets[0].digest = null;
  assert.equal(selectUpdate([release('0.4.0'), release('0.6.0', { draft: true }),
    release('0.6.0', { prerelease: true }), release('0.6.0', { tag_name: 'profile-manager-v0.6.0' }),
    wrongAsset, wrongDigest], '0.5.0', 'beta'), null);
});
test('coalesces concurrent checks and keeps offline errors recoverable', async () => {
  let attempts = 0;
  const checker = createUpdateChecker({ version: '0.5.0-beta.1', channel: 'beta', fetchRelease: async () => {
    if (++attempts === 1) throw new Error('offline');
    return { ok: true, json: async () => [release('0.5.0-beta.2')] };
  } });
  const first = checker.check();
  assert.equal(checker.check(), first);
  assert.equal((await first).status, 'unavailable');
  assert.equal((await checker.check()).latest.version, '0.5.0-beta.2');
  assert.equal(attempts, 2);
});
