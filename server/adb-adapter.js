// Optional local Android Debug Bridge adapter for user-owned USB devices only.
import { execFileSync } from 'child_process';

export const ADB_ADAPTER_NOTE = 'User-owned devices via host adb only. Not equivalent to Multilogin cloud phone farms.';

export function adbAvailability() {
  try {
    execFileSync('adb', ['version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    return { available: true, farmEquivalent: false, note: ADB_ADAPTER_NOTE };
  } catch (e) {
    const reason = e.code === 'ENOENT' ? 'adb_not_on_path' : 'adb_error';
    return { available: false, reason, farmEquivalent: false, note: ADB_ADAPTER_NOTE };
  }
}

export function listAdbDevices() {
  const base = adbAvailability();
  if (!base.available) return { ...base, devices: [] };
  try {
    const out = execFileSync('adb', ['devices', '-l'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    const devices = [];
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^([^\s]+)\s+(device|offline|unauthorized)\s*(.*)$/);
      if (!m) continue;
      const [, serial, state, rest] = m;
      if (serial === 'List') continue;
      const props = {};
      for (const token of rest.trim().split(/\s+/)) {
        const kv = token.match(/^([^:]+):(.+)$/);
        if (kv) props[kv[1]] = kv[2];
      }
      devices.push({ serial, state, ...props });
    }
    return { ...base, devices };
  } catch (e) {
    return { ...base, available: false, reason: 'adb_devices_failed', message: String(e.message || e), devices: [] };
  }
}

export function adbAdapterReport() {
  return { generatedAt: new Date().toISOString(), ...listAdbDevices() };
}
