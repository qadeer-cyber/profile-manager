// Playwright is used only when automation or headless is explicitly requested.
export const AUTOMATION_ADAPTER = Object.freeze({
  id: 'playwright-persistent-context',
  triggers: ['opts.automation truthy', 'PM_AUTOMATION_DEFAULT env (dev only)', 'headless launch'],
  manualDefault: 'native-chromium-spawn',
  notes: [
    'Manual profile Start uses native spawn without --remote-debugging-pipe or --enable-automation.',
    'CDP TCP port opens only when automation is enabled on the launch request.',
  ],
});

export function automationAdapterReport(opts = {}) {
  return { ...AUTOMATION_ADAPTER, launchRequest: opts };
}
