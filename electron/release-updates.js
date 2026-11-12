const repository = 'qadeer-cyber/profile-manager';
const installer = 'Azwah-Setup-x64.exe';
const pattern = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-beta\.(0|[1-9]\d{0,8}))?$/;
function versionParts(version) {
  const match = typeof version === 'string' && pattern.exec(version);
  return match ? [...match.slice(1, 4).map(Number), match[4] === undefined ? Infinity : Number(match[4])] : null;
}
function compare(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}
export function selectUpdate(releases, current, channel) {
  const installed = versionParts(current);
  if (!installed || !['stable', 'beta'].includes(channel) || !Array.isArray(releases)) throw new Error('Invalid AZWAH update metadata.');
  let latest = null;
  for (const release of releases) {
    const tag = release?.tag_name;
    if (typeof tag !== 'string' || !tag.startsWith('azwah-v') || release.draft !== false) continue;
    const version = tag.slice(7);
    const parts = versionParts(version);
    if (!parts || release.prerelease !== (parts[3] !== Infinity) || (channel === 'stable' && release.prerelease) || compare(parts, installed) <= 0) continue;
    if (latest && compare(parts, versionParts(latest.version)) <= 0) continue;
    const url = `https://github.com/${repository}/releases/tag/${tag}`;
    const download = `https://github.com/${repository}/releases/download/${tag}/${installer}`;
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const asset = assets.find(item => item?.name === installer && item.browser_download_url === download);
    if (!asset || asset.state !== 'uploaded' || !Number.isSafeInteger(asset.size) || asset.size <= 0 || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '')) continue;
    latest = { version, url, download, size: asset.size, sha256: asset.digest.slice(7),
      publishedAt: release.published_at, notes: typeof release.body === 'string' ? release.body.slice(0, 8000) : '' };
  }
  return latest;
}
export function createUpdateChecker({ version, channel, fetchRelease = fetch }) {
  let state = { version, channel, status: 'idle', latest: null, checkedAt: null };
  let pending;
  return {
    status: () => state,
    check() {
      if (pending) return pending;
      state = { ...state, status: 'checking' };
      pending = (async () => {
        try {
          const response = await fetchRelease(`https://api.github.com/repos/${repository}/releases?per_page=100`, {
            redirect: 'error', signal: AbortSignal.timeout(12000), headers: { Accept: 'application/vnd.github+json' },
          });
          if (!response.ok) throw new Error('Release feed unavailable.');
          const latest = selectUpdate(await response.json(), version, channel);
          state = { ...state, status: latest ? 'available' : 'current', latest, checkedAt: new Date().toISOString() };
        } catch {
          state = { ...state, status: 'unavailable' };
        }
        return state;
      })().finally(() => { pending = undefined; });
      return pending;
    },
  };
}
