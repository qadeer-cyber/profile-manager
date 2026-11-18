import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const source = 'https://github.com/qadeer-cyber/profile-manager/releases/download/';
const maxBytes = 1024 ** 3;

export async function downloadUpdate(asset, { fetchAsset = fetch, signal, progress = () => {}, directory = tmpdir() } = {}) {
  const initial = new URL(asset.download);
  if (!initial.href.startsWith(source) || !/^azwah-v[0-9.]+(?:-beta\.[0-9]+)?\/Azwah-Setup-x64\.exe$/.test(initial.href.slice(source.length)) ||
      !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > maxBytes ||
      !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid installer metadata.');
  const deadline = AbortSignal.timeout(20 * 60 * 1000);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const folder = await mkdtemp(join(directory, 'azwah-update-'));
  const partial = join(folder, 'installer.partial');
  const file = join(folder, 'Azwah-Setup-x64.exe');
  try {
    const first = await fetchAsset(initial, { redirect: 'manual', signal: requestSignal });
    let response = first;
    if ([301, 302, 303, 307, 308].includes(first.status)) {
      await first.body?.cancel();
      const next = new URL(first.headers.get('location'));
      if (next.origin !== 'https://release-assets.githubusercontent.com' || next.username || next.password) {
        throw new Error('Unexpected installer redirect.');
      }
      response = await fetchAsset(next, { redirect: 'error', signal: requestSignal });
    }
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      throw new Error('Installer unavailable.');
    }
    let received = 0;
    const hash = createHash('sha256');
    const count = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > asset.size) return callback(new Error('Installer exceeds its expected size.'));
        hash.update(chunk);
        progress(received);
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), count, createWriteStream(partial, { flags: 'wx' }), { signal: requestSignal });
    if (received !== asset.size || hash.digest('hex') !== asset.sha256) throw new Error('Installer integrity check failed.');
    requestSignal.throwIfAborted();
    await rename(partial, file);
    return file;
  } catch (error) {
    await rm(folder, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
