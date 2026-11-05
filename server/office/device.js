import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
export function deviceIdentity() {
  let identifier;
  if (process.platform === 'win32') {
    const output = execFileSync('reg.exe', ['query','HKLM\\SOFTWARE\\Microsoft\\Cryptography','/v','MachineGuid','/reg:64'], { encoding:'utf8', windowsHide:true, timeout:5000 });
    identifier = output.match(/MachineGuid\s+REG_SZ\s+([a-f0-9-]+)/i)?.[1];
  } else if (process.platform === 'linux') identifier = fs.readFileSync('/etc/machine-id','utf8').trim();
  else if (process.platform === 'darwin') identifier = execFileSync('/usr/sbin/ioreg',['-rd1','-c','IOPlatformExpertDevice'],{encoding:'utf8',timeout:5000}).match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1];
  if (!identifier || identifier.length < 16) throw Object.assign(Error('Stable device identity unavailable. Activation requires administrator review.'), {code:'DEVICE_ID_UNAVAILABLE'});
  return 'AZD1-' + crypto.createHash('sha256').update('azwah-office-device-v1\0'+identifier.trim().toLowerCase()).digest('hex');
}
