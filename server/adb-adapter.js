// Optional local Android Debug Bridge adapter for user-owned USB/network devices only.
import { execFileSync } from 'child_process';
import { getSetting, setSetting } from './db.js';

export const ADB_ADAPTER_NOTE = 'User-owned devices via host adb only. Not equivalent to Multilogin cloud phone farms.';
export const ADB_VERIFIED_SCOPE = 'Host adb discovery/connect/disconnect and read-only device info when adb is on PATH or PM_MOCK_ADB=1 in CI. Real USB verification requires a physical device attached to the runner.';

const SERIAL_RE = /^[A-Za-z0-9_.:-]{1,120}$/;
const CONNECT_TARGET_RE = /^[A-Za-z0-9_.:-]{1,120}$/;

let adbExecImpl = (args, opts = {}) => execFileSync('adb', args, {
  encoding: 'utf8',
  timeout: opts.timeout ?? 8000,
  windowsHide: true,
  maxBuffer: 1024 * 512,
});

/** Test hook: replace adb subprocess (never used in production). */
export function setAdbExecForTests(fn) {
  adbExecImpl = fn || ((args, opts = {}) => execFileSync('adb', args, {
    encoding: 'utf8', timeout: opts.timeout ?? 8000, windowsHide: true, maxBuffer: 1024 * 512,
  }));
}

export function mockAdbEnabled() {
  return process.env.PM_MOCK_ADB === '1' || process.env.PM_ADB_MOCK === '1';
}

const mockStore = {
  devices: [
    { serial: 'mock-usb-001', state: 'device', model: 'MockPhone', product: 'mockproduct', transport: 'usb' },
    { serial: '192.168.1.50:5555', state: 'device', model: 'MockNet', product: 'mocknet', transport: 'local' },
    { serial: 'mock-unauth', state: 'unauthorized', model: 'Locked', product: 'locked', transport: 'usb' },
  ],
};

function mockAdbExec(args) {
  const joined = args.join(' ');
  if (args[0] === 'version') return 'Android Debug Bridge version 1.0.41\nMock adb for CI (PM_MOCK_ADB=1)\n';
  if (args[0] === 'devices' && args[1] === '-l') {
    return mockStore.devices.map(d => {
      const tail = [`product:${d.product}`, `model:${d.model}`, `device:${d.product}`, `transport_id:1`].join(' ');
      return `${d.serial}\t${d.state} ${tail}`;
    }).join('\n') + '\n';
  }
  if (args[0] === 'connect') {
    const target = args[1];
    if (!CONNECT_TARGET_RE.test(target)) throw Object.assign(new Error('bad target'), { code: 1 });
    if (!mockStore.devices.some(d => d.serial === target)) {
      mockStore.devices.push({ serial: target, state: 'device', model: 'MockConnected', product: 'mock', transport: 'local' });
    }
    return `connected to ${target}\n`;
  }
  if (args[0] === 'disconnect') {
    const target = args[1] || '';
    if (target) mockStore.devices = mockStore.devices.filter(d => d.serial !== target);
    return `disconnected ${target || 'all'}\n`;
  }
  if (args.includes('get-state')) {
    const serial = args[args.indexOf('-s') + 1];
    const d = mockStore.devices.find(x => x.serial === serial);
    if (!d) throw Object.assign(new Error('device not found'), { code: 1 });
    return `${d.state === 'device' ? 'device' : d.state}\n`;
  }
  if (joined.includes('shell') && joined.includes('getprop')) {
    const serial = args[args.indexOf('-s') + 1];
    const d = mockStore.devices.find(x => x.serial === serial);
    if (!d) throw Object.assign(new Error('device not found'), { code: 1 });
    const prop = args[args.length - 1];
    const map = {
      'ro.product.model': d.model || 'Mock',
      'ro.product.manufacturer': 'Mock OEM',
      'ro.build.version.release': '14',
    };
    return `${map[prop] || ''}\n`;
  }
  throw Object.assign(new Error(`mock adb unsupported: ${joined}`), { code: 1 });
}

function runAdb(args, opts) {
  if (mockAdbEnabled()) return mockAdbExec(args);
  return adbExecImpl(args, opts);
}

export function validateAdbSerial(serial) {
  const s = String(serial || '').trim();
  if (!s || !SERIAL_RE.test(s)) {
    return { ok: false, error: 'invalid_serial', message: 'serial must be 1-120 alphanumeric, dot, colon, underscore, or hyphen' };
  }
  return { ok: true, serial: s };
}

export function validateAdbConnectTarget(target) {
  const t = String(target || '').trim();
  if (!t || !CONNECT_TARGET_RE.test(t)) {
    return { ok: false, error: 'invalid_target', message: 'target must be a serial or host:port (1-120 chars)' };
  }
  return { ok: true, target: t };
}

export function adbAvailability() {
  if (mockAdbEnabled()) {
    return {
      available: true,
      reason: 'mock_adb',
      farmEquivalent: false,
      note: ADB_ADAPTER_NOTE,
      mockMode: true,
      verifiedScope: ADB_VERIFIED_SCOPE,
    };
  }
  try {
    runAdb(['version'], { timeout: 5000 });
    return {
      available: true,
      farmEquivalent: false,
      note: ADB_ADAPTER_NOTE,
      mockMode: false,
      verifiedScope: ADB_VERIFIED_SCOPE,
    };
  } catch (e) {
    const reason = e.code === 'ENOENT' ? 'adb_not_on_path' : 'adb_error';
    return {
      available: false,
      reason,
      farmEquivalent: false,
      note: ADB_ADAPTER_NOTE,
      mockMode: false,
      verifiedScope: ADB_VERIFIED_SCOPE,
      message: String(e.message || e).slice(0, 200),
    };
  }
}

/** @param {string} text output of `adb devices -l` */
export function parseAdbDevicesListing(text) {
  const devices = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^([^\s]+)\s+(device|offline|unauthorized)\s*(.*)$/);
    if (!m) continue;
    const [, serial, state, rest] = m;
    if (serial === 'List') continue;
    const props = {};
    for (const token of rest.trim().split(/\s+/)) {
      const kv = token.match(/^([^:]+):(.+)$/);
      if (kv) props[kv[1]] = kv[2];
    }
    devices.push({
      serial,
      state,
      usbAuthorized: state !== 'unauthorized',
      ...props,
    });
  }
  return devices;
}

export function listAdbDevices() {
  const base = adbAvailability();
  if (!base.available) return { ...base, devices: [], counts: { device: 0, offline: 0, unauthorized: 0 } };
  try {
    const out = runAdb(['devices', '-l'], { timeout: 8000 });
    const devices = parseAdbDevicesListing(out);
    const counts = { device: 0, offline: 0, unauthorized: 0 };
    for (const d of devices) {
      if (d.state === 'device') counts.device += 1;
      else if (d.state === 'offline') counts.offline += 1;
      else if (d.state === 'unauthorized') counts.unauthorized += 1;
    }
    return { ...base, devices, counts, selectedSerial: getSelectedAdbSerial() };
  } catch (e) {
    return {
      ...base,
      available: false,
      reason: 'adb_devices_failed',
      message: String(e.message || e),
      devices: [],
      counts: { device: 0, offline: 0, unauthorized: 0 },
    };
  }
}

export function adbAdapterReport() {
  return { generatedAt: new Date().toISOString(), ...listAdbDevices() };
}

export function getSelectedAdbSerial() {
  const s = getSetting('adbSelectedSerial', null);
  return typeof s === 'string' && s ? s : null;
}

export function setSelectedAdbSerial(serial) {
  if (serial == null || serial === '') {
    setSetting('adbSelectedSerial', null);
    return { selectedSerial: null };
  }
  const v = validateAdbSerial(serial);
  if (!v.ok) return { ok: false, ...v };
  setSetting('adbSelectedSerial', v.serial);
  return { ok: true, selectedSerial: v.serial };
}

export function adbDiagnostics() {
  const base = adbAvailability();
  let versionLine = null;
  let serverHealthy = false;
  if (base.available) {
    try {
      const ver = runAdb(['version'], { timeout: 5000 });
      versionLine = ver.split(/\r?\n/).find(l => /Android Debug Bridge/i.test(l)) || ver.split(/\r?\n/)[0];
      serverHealthy = true;
    } catch (e) {
      versionLine = String(e.message || e).slice(0, 200);
    }
  }
  const listing = listAdbDevices();
  const selected = getSelectedAdbSerial();
  const selectedPresent = selected && listing.devices.some(d => d.serial === selected && d.state === 'device');
  return {
    generatedAt: new Date().toISOString(),
    ...base,
    versionLine,
    serverHealthy,
    counts: listing.counts || { device: 0, offline: 0, unauthorized: 0 },
    selectedSerial: selected,
    selectedPresent: !!selectedPresent,
    recoveryHints: [
      listing.counts?.unauthorized ? 'Accept the USB debugging prompt on the device, then refresh.' : null,
      !base.available && !base.mockMode ? 'Install Android platform-tools and ensure adb is on PATH.' : null,
      selected && !selectedPresent ? 'Selected device is missing or not in device state — reconnect or choose another.' : null,
    ].filter(Boolean),
  };
}

/** Connect to an explicitly authorized network ADB endpoint (user-owned). */
export function connectAdbTarget(serialOrHost) {
  const v = validateAdbConnectTarget(serialOrHost);
  if (!v.ok) return { ok: false, ...v };
  const base = adbAvailability();
  if (!base.available) return { ok: false, error: base.reason, message: 'adb is not available on PATH' };
  try {
    const out = runAdb(['connect', v.target], { timeout: 15000 });
    const listing = listAdbDevices();
    return { ok: true, target: v.target, output: out.trim(), devices: listing.devices, counts: listing.counts };
  } catch (e) {
    return { ok: false, target: v.target, error: 'adb_connect_failed', message: String(e.message || e).slice(0, 300) };
  }
}

export function disconnectAdbTarget(serialOrHost) {
  const raw = String(serialOrHost || '').trim();
  const base = adbAvailability();
  if (!base.available) return { ok: false, error: base.reason, message: 'adb is not available on PATH' };
  try {
    const args = raw ? ['disconnect', raw] : ['disconnect'];
    if (raw) {
      const v = validateAdbConnectTarget(raw);
      if (!v.ok) return { ok: false, ...v };
    }
    const out = runAdb(args, { timeout: 10000 });
    if (getSelectedAdbSerial() === raw) setSelectedAdbSerial(null);
    const listing = listAdbDevices();
    return { ok: true, target: raw || null, output: out.trim(), devices: listing.devices };
  } catch (e) {
    return { ok: false, target: raw || null, error: 'adb_disconnect_failed', message: String(e.message || e).slice(0, 300) };
  }
}

const DEVICE_INFO_PROPS = [
  'ro.product.model',
  'ro.product.manufacturer',
  'ro.build.version.release',
];

export function getAdbDeviceInfo(serial) {
  const v = validateAdbSerial(serial);
  if (!v.ok) return { ok: false, ...v };
  const base = adbAvailability();
  if (!base.available) return { ok: false, error: base.reason, message: 'adb is not available on PATH' };
  try {
    const stateOut = runAdb(['-s', v.serial, 'get-state'], { timeout: 5000 }).trim();
    const properties = {};
    for (const prop of DEVICE_INFO_PROPS) {
      properties[prop] = runAdb(['-s', v.serial, 'shell', 'getprop', prop], { timeout: 5000 }).trim();
    }
    return {
      ok: true,
      serial: v.serial,
      state: stateOut,
      usbAuthorized: stateOut === 'device',
      properties,
      readOnly: true,
      mockMode: !!base.mockMode,
    };
  } catch (e) {
    return { ok: false, serial: v.serial, error: 'adb_device_info_failed', message: String(e.message || e).slice(0, 300) };
  }
}
