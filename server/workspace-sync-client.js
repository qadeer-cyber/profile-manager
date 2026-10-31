import https from 'node:https';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createStreamedWorkspaceBackup, spoolBackupUpload, processStreamedBackup } from './backup-stream.js';
const bad = message => Object.assign(Error(message), { status: 400, code: 'WORKSPACE_SYNC_FAILED' });
function endpoint({ serverUrl, remoteId, token }) {
  let url; try { url = new URL(serverUrl); } catch { throw bad('A trusted HTTPS relay URL is required'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname) || !/^[0-9a-f-]{36}$/i.test(remoteId || '') || !/^[A-Za-z0-9_-]{32,256}$/.test(token || '')) throw bad('Use an HTTPS relay origin, workspace UUID and device access token');
  url.pathname = `/v1/workspaces/${remoteId}/snapshot`; return url;
}
function request(url, options, file) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { ...options, timeout: 30000, ...(process.env.PM_SYNC_CA_FILE && { ca: fs.readFileSync(process.env.PM_SYNC_CA_FILE) }) }, resolve);
    req.on('error', () => reject(bad('TLS relay connection failed; check its certificate and availability')));
    req.on('timeout', () => req.destroy(Error('timeout')));
    if (file) pipeline(fs.createReadStream(file), req).catch(reject); else req.end();
  });
}
async function requireSuccess(response) {
  if (response.statusCode === 200) return response;
  response.resume();
  if (response.statusCode === 409) throw Object.assign(bad('Remote workspace changed. Pull a new copy and resolve the conflict before pushing.'), { status: 409 });
  throw bad(`Relay rejected the request (HTTP ${response.statusCode}); credentials and passphrases were not logged`);
}
export async function pushWorkspaceSnapshot(id, options) {
  const url = endpoint(options);
  if (options.confirmSensitive !== true || !Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) throw bad('Confirm sensitive export and specify the expected remote revision');
  const transfer = await createStreamedWorkspaceBackup(id, options);
  try {
    const response = await requireSuccess(await request(url, { method: 'PUT', headers: { Authorization: `Bearer ${options.token}`, 'If-Match': `"${options.expectedRevision}"`, 'Content-Type': 'application/octet-stream', 'Content-Length': transfer.size } }, transfer.file));
    let data = ''; for await (const chunk of response) { data += chunk; if (data.length > 4096) { response.destroy(); throw bad('Relay response exceeded limits'); } }
    const result = JSON.parse(data);
    if (result.revision !== options.expectedRevision + 1 || !/^[0-9a-f]{64}$/.test(result.sha256 || '')) throw bad('Relay response is invalid');
    return result;
  } finally { transfer.cleanup(); }
}
export async function pullWorkspaceSnapshot(options) {
  const url = endpoint(options);
  if (options.confirmSensitive !== true) throw bad('Confirm restoration of the remote encrypted workspace');
  const response = await requireSuccess(await request(url, { method: 'GET', headers: { Authorization: `Bearer ${options.token}` } }));
  const revision = /^"([1-9]\d{0,12})"$/.exec(response.headers.etag || '')?.[1];
  if (!revision) { response.destroy(); throw bad('Relay revision is invalid'); }
  const transfer = await spoolBackupUpload(response);
  try {
    const preview = await processStreamedBackup(transfer, { passphrase: options.passphrase, inspect: true });
    if (preview.format !== 'profile-manager-workspace-backup') throw bad('Remote snapshot is not a workspace backup');
    // The parser uses private exclusive files. A new upload owns the second parse.
    for (const name of fs.readdirSync(transfer.dir)) if (name === 'authenticated.pmb' || /^entry-\d+$/.test(name)) fs.rmSync(transfer.dir + '/' + name);
    const restored = await processStreamedBackup(transfer, { passphrase: options.passphrase, collision: 'rename' });
    return { revision: Number(revision), ...restored };
  } finally { transfer.cleanup(); }
}
