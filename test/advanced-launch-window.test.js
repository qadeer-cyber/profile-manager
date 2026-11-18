import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAdvancedSettings } from '../server/advanced-settings.js';
import { advancedLaunchPlan } from '../server/advanced-launch.js';
import { MANIFEST } from '../server/chromium.js';

test('Latitude-class 1366x768 preset emits window size without maximized flag', () => {
  const settings = validateAdvancedSettings({ screen: { preset: '1366x768' } });
  const plan = advancedLaunchPlan(settings, { version: MANIFEST.browserVersion, headless: false });
  assert.ok(plan.args.includes('--window-size=1366,768'));
  assert.equal(plan.args.includes('--start-maximized'), false);
});

test('custom window position is emitted when not maximized', () => {
  const settings = validateAdvancedSettings({
    screen: { preset: '1366x768', windowX: 12, windowY: 24 },
  });
  const plan = advancedLaunchPlan(settings, { version: MANIFEST.browserVersion, headless: false });
  assert.ok(plan.args.includes('--window-position=12,24'));
  assert.ok(plan.args.includes('--window-size=1366,768'));
});
