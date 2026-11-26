// CI-only transport for the installed update test (Milestone D).
//
// The real updater talks to two fixed GitHub URLs: the releases list and the pinned installer
// download. This wrapper maps exactly those two URLs to a 127.0.0.1 fixture so Windows CI can run
// the shipping update code against CI-built installers without publishing anything. Every other
// URL is refused. All updater validation (tag pattern, asset name, URL allowlist, redirect origin,
// size and SHA-256) still runs unchanged on top of it.
//
// main.js only builds this when PM_SMOKE=1 and PM_SMOKE_UPDATE_ORIGIN are both set; a normal
// installed app never uses it.
const RELEASES = 'https://api.github.com/repos/qadeer-cyber/profile-manager/releases?per_page=100';
const DOWNLOAD = /^https:\/\/github\.com\/qadeer-cyber\/profile-manager\/releases\/download\/(azwah-v\d+\.\d+\.\d+(?:-beta\.\d+)?)\/Azwah-Setup-x64\.exe$/;
const ORIGIN = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/;

export function loopbackUpdateTransport(origin, { fetchImpl = fetch } = {}) {
  const match = typeof origin === 'string' && ORIGIN.exec(origin);
  if (!match || Number(match[1]) > 65535) throw new Error('Update test origin must be http://127.0.0.1:<port>.');
  return function updateTestFetch(input, options) {
    const url = String(input instanceof URL ? input.href : input);
    if (url === RELEASES) return fetchImpl(`${origin}/releases`, options);
    const download = DOWNLOAD.exec(url);
    if (download) return fetchImpl(`${origin}/download/${download[1]}/Azwah-Setup-x64.exe`, options);
    return Promise.reject(new Error('Update test transport refused an unexpected URL.'));
  };
}
