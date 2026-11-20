// Option A (owner-approved): ordinary Chrome Stable profiles launch as a genuine manual browser, with no
// automation pipe, remote debugging or concealment switch. A profile that needs a feature only the
// controlled path can provide stays controlled, and says why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stableLaunchMode, MANUAL_FORBIDDEN_SWITCHES } from '../server/browser-runtime/stable-launch-mode.js';

const plain = { proxy: null, timezoneId: '', coordinates: null, launch: {}, automation: false, headless: false };

test('a direct profile with no overrides launches manually', () => {
  assert.deepEqual(stableLaunchMode(plain), { mode: 'manual', reasons: [] });
});

test('each controlled-only feature keeps the profile controlled, with a reason', () => {
  const cases = [
    [{ proxy: { host: 'p.example', port: 1080 } }, 'proxy'],
    [{ timezoneId: 'Asia/Tokyo' }, 'timezone'],
    [{ coordinates: { latitude: 1, longitude: 2, accuracy: 10 } }, 'coordinates'],
    [{ launch: { viewport: { width: 800, height: 600 } } }, 'screen'],
    [{ launch: { screen: { width: 800, height: 600 } } }, 'screen'],
    [{ launch: { deviceScaleFactor: 2 } }, 'screen'],
    [{ launch: { userAgent: 'Mozilla/5.0 ...' } }, 'userAgent'],
    [{ automation: true }, 'automation'],
    [{ headless: true }, 'headless'],
  ];
  for (const [change, reason] of cases) {
    const result = stableLaunchMode({ ...plain, ...change });
    assert.equal(result.mode, 'controlled', reason);
    assert.ok(result.reasons.includes(reason), `${reason}: ${JSON.stringify(result)}`);
  }
  assert.deepEqual(stableLaunchMode({ ...plain, proxy: { host: 'p' }, timezoneId: 'UTC' }).reasons, ['proxy', 'timezone'], 'all reasons listed');
});

test('manual launches forbid automation, remote debugging and concealment switches', () => {
  for (const flag of ['--remote-debugging-pipe', '--remote-debugging-port', '--enable-automation', '--headless', '--disable-blink-features']) {
    assert.ok(MANUAL_FORBIDDEN_SWITCHES.includes(flag), flag);
  }
});

test('the saved profile predicts the same mode the launch will choose', async () => {
  const { predictStableLaunchMode } = await import('../server/browser-runtime/stable-launch-mode.js');
  const base = { browserSettings: { timezoneId: '' }, advancedSettings: { geolocation: { mode: 'manual', latitude: null, longitude: null }, screen: { preset: 'native' }, userAgent: { mode: 'default' } }, proxy: null, automationEnabled: false };
  assert.deepEqual(predictStableLaunchMode(base), { mode: 'manual', reasons: [] });
  const withAll = predictStableLaunchMode({ ...base, proxy: { host: 'p' }, automationEnabled: true, browserSettings: { timezoneId: 'UTC' },
    advancedSettings: { geolocation: { mode: 'manual', latitude: 1, longitude: 2, accuracy: 5 }, screen: { preset: '1280x800', width: 1280, height: 800 }, userAgent: { mode: 'reduced' } } });
  assert.deepEqual(withAll.reasons, ['proxy', 'timezone', 'coordinates', 'screen', 'userAgent', 'automation']);
  assert.equal(predictStableLaunchMode({ ...base, browserEngine: 'firefox' }), null, 'not a Chrome profile');
});

test('the native launcher refuses automation, debugging and concealment switches and strips AZWAH secrets', async () => {
  const { assertNativeLaunchArgs, nativeChromiumEnv } = await import('../server/browser-runtime/native-chromium.js');
  for (const flag of ['--remote-debugging-port=9222', '--remote-debugging-pipe', '--enable-automation', '--headless=new', '--disable-blink-features=AutomationControlled']) {
    assert.throws(() => assertNativeLaunchArgs(['--lang=en-US', flag]), err => err.code === 'NATIVE_LAUNCH_FORBIDDEN_ARG', flag);
  }
  assert.doesNotThrow(() => assertNativeLaunchArgs(['--lang=en-US', '--no-first-run', '--force-webrtc-ip-handling-policy=default_public_interface_only']));
  const env = nativeChromiumEnv({ regional: {} }, { PATH: 'p', PM_API_TOKEN: 'a', PM_SECRET: 'b', PM_UI_TOKEN: 'c', NODE_OPTIONS: '--x', ELECTRON_RUN_AS_NODE: '1', AZWAH_MAXMIND_LICENSE_KEY: 'k' });
  assert.deepEqual(Object.keys(env), ['PATH'], 'Chrome gets no AZWAH secrets');
});

test('per-profile choice: a proxy profile set to manual launches without the controlled connection', async () => {
  const proxy = { host: 'p.example', port: 1080 };
  assert.deepEqual(stableLaunchMode({ ...plain, proxy, proxyManual: true }), { mode: 'manual', reasons: [] });
  assert.deepEqual(stableLaunchMode({ ...plain, proxy, proxyManual: false }).reasons, ['proxy']);
  // Manual proxy does not lift other controlled-only needs.
  assert.deepEqual(stableLaunchMode({ ...plain, proxy, proxyManual: true, automation: true }).reasons, ['automation']);
  assert.deepEqual(stableLaunchMode({ ...plain, proxy, proxyManual: true, timezoneId: 'Asia/Tokyo' }).reasons, ['timezone']);
  const { predictStableLaunchMode } = await import('../server/browser-runtime/stable-launch-mode.js');
  const base = { browserSettings: { timezoneId: '' }, advancedSettings: { geolocation: { mode: 'auto' }, screen: { preset: 'native' }, userAgent: { mode: 'default' } }, proxy, automationEnabled: false };
  assert.deepEqual(predictStableLaunchMode(base).reasons, ['proxy']);
  assert.deepEqual(predictStableLaunchMode({ ...base, advancedSettings: { ...base.advancedSettings, proxyLaunch: 'manual' } }), { mode: 'manual', reasons: [] });
});

test('proxyLaunch is validated and stored', async () => {
  const { validateAdvancedSettings } = await import('../server/advanced-settings.js');
  assert.equal(validateAdvancedSettings({ proxyLaunch: 'manual' }).proxyLaunch, 'manual');
  assert.equal(validateAdvancedSettings({ proxyLaunch: 'controlled' }).proxyLaunch, 'controlled');
  assert.throws(() => validateAdvancedSettings({ proxyLaunch: 'stealth' }));
  const kept = validateAdvancedSettings({ runtime: 'stable-chrome' }, validateAdvancedSettings({ proxyLaunch: 'manual' }));
  assert.equal(kept.proxyLaunch, 'manual', 'kept across other edits');
});
