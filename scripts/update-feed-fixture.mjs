// Local stand-in for the GitHub releases API and release download host, used only by the
// Milestone D update test. It serves one real installer file with its real size and SHA-256.
//
//   node scripts/update-feed-fixture.mjs --installer <path> --version 2.0.0-beta.2 [--tamper] [--port-file <path>]
//
// --tamper publishes a wrong SHA-256 digest for the same bytes, so the updater must refuse the
// download. The server binds 127.0.0.1 on an OS-assigned port and prints/writes its origin.
import { createReadStream, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const VERSION = /^\d+\.\d+\.\d+-beta\.\d+$/;

export async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function startUpdateFeed({ installer, version, tamper = false, previous = null }) {
  if (!VERSION.test(version)) throw new Error('version must look like 2.0.0-beta.2');
  const size = statSync(installer).size;
  const real = await sha256File(installer);
  const digest = tamper ? createHash('sha256').update('tampered:' + real).digest('hex') : real;
  const release = (tag, prerelease, asset) => ({
    tag_name: tag, draft: false, prerelease, published_at: new Date().toISOString(),
    body: `Milestone D update fixture for ${tag}.`, assets: asset ? [asset] : [],
  });
  const tag = `azwah-v${version}`;
  const releases = [
    release(tag, true, {
      name: 'Azwah-Setup-x64.exe', state: 'uploaded', size, digest: `sha256:${digest}`,
      browser_download_url: `https://github.com/qadeer-cyber/profile-manager/releases/download/${tag}/Azwah-Setup-x64.exe`,
    }),
    ...(previous ? [release(`azwah-v${previous}`, true, null)] : []),
  ];
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    if (req.url === '/releases') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(releases));
      return;
    }
    if (req.url === `/download/${tag}/Azwah-Setup-x64.exe`) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size });
      createReadStream(installer).pipe(res);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, size, sha256: real, publishedDigest: digest, tag, requests, close: () => new Promise(resolve => server.close(resolve)) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const feed = await startUpdateFeed({ installer: arg('--installer'), version: arg('--version'), tamper: process.argv.includes('--tamper'), previous: arg('--previous') || null });
  const info = JSON.stringify({ origin: feed.origin, size: feed.size, sha256: feed.sha256, publishedDigest: feed.publishedDigest, tag: feed.tag });
  if (arg('--port-file')) writeFileSync(arg('--port-file'), info);
  console.log('UPDATE-FEED ' + info);
}
