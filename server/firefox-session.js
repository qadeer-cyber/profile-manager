import fs from 'node:fs';
// The browser's canonical profile and process identity must agree with the
// selected profile. Windows launcher PIDs are not browser PIDs.
export function firefoxSessionIdentity(session, profileDir, expectedPid) {
  const capabilities = session?.capabilities || session?.value?.capabilities;
  let sameProfile = false;
  try {
    const canonical = file => { const value = fs.realpathSync.native(file); return process.platform === 'win32' ? value.toLowerCase() : value; };
    sameProfile = canonical(capabilities?.['moz:profile']) === canonical(profileDir);
  } catch {}
  const pid = capabilities?.['moz:processID'];
  if (!sameProfile || capabilities?.browserName !== 'firefox' || !Number.isSafeInteger(pid) || pid <= 0 || (expectedPid !== undefined && pid !== expectedPid)) {
    throw Object.assign(Error('Firefox session identity does not match this profile. Stop and relaunch it before retrying.'), { status: 409, code: 'GECKO_SESSION_MISMATCH' });
  }
  return { pid };
}
