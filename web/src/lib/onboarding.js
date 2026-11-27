// First-run guide model. Pure (no React). Every step's state comes from real data (the browser check and the counts in
// /api/meta); nothing is marked done because the user clicked it. The proxy step is optional.

export const GUIDE_KEY = 'azwah.getStarted.dismissed';

export function onboardingSteps({ browser = null, meta = {} } = {}) {
  const hasBrowser = Boolean(browser?.installed || browser?.azwahNative);
  const profiles = meta.profileCount ?? 0;
  const engine = browser?.azwahNative ? 'AZWAH Chromium (included with AZWAH)'
    : browser?.runtime === 'stable-chrome' ? 'Google Chrome Stable' : 'Chromium';
  return [
    { id: 'browser', title: 'A browser is ready', state: browser == null ? 'unknown' : hasBrowser ? 'done' : 'todo', required: true,
      detail: browser == null ? 'Checking this computer…' : hasBrowser ? `${engine} will open your profiles.`
        : browser?.runtime === 'stable-chrome' ? 'Google Chrome is not installed on this PC. Install it, then reopen AZWAH.' : 'Chromium is not installed yet. Download it from Diagnostics.',
      action: !hasBrowser && browser != null ? (browser?.runtime === 'stable-chrome' ? 'get-chrome' : 'diagnostics') : null },
    { id: 'proxy', title: 'Add proxies (optional)', state: (meta.proxyCount ?? 0) > 0 ? 'done' : 'todo', required: false,
      detail: (meta.proxyCount ?? 0) > 0 ? `${meta.proxyCount} proxy${meta.proxyCount === 1 ? '' : ' proxies'} saved.`
        : 'Without a proxy, websites see this computer’s own IP address. Paste a list to create one profile per proxy.',
      action: (meta.proxyCount ?? 0) > 0 ? null : 'proxies' },
    { id: 'profile', title: 'Create your first profile', state: profiles > 0 ? 'done' : 'todo', required: true,
      detail: profiles > 0 ? `${profiles} profile${profiles === 1 ? '' : 's'} created.` : 'Each profile has its own cookies, storage and network settings.',
      action: profiles > 0 ? null : 'create' },
    { id: 'launch', title: 'Launch it and check what sites see', required: true,
      state: (meta.launchedCount ?? 0) > 0 ? 'done' : profiles > 0 && hasBrowser ? 'todo' : 'blocked',
      detail: (meta.launchedCount ?? 0) > 0 ? 'Launched. Open a profile’s Details to see its health: what a website would see and where settings disagree.'
        : profiles > 0 && hasBrowser ? 'Press ▶ on a profile. Then open ⋮ → Details to see its health.' : 'Needs a browser and a profile first.',
      action: null },
  ];
}

// Shown until the required steps are done, unless the user dismissed it. `forced` reopens it from the empty table.
export function guideVisible(steps, { dismissed = false, forced = false } = {}) {
  const open = steps.some(s => s.required && s.state !== 'done');
  return forced ? true : open && !dismissed;
}
export const guideProgress = steps => {
  const required = steps.filter(s => s.required);
  return { done: required.filter(s => s.state === 'done').length, total: required.length };
};

// localStorage is a per-viewer convenience: it can throw or be empty (private window), so every access is guarded.
export function readDismissed(storage = globalThis.localStorage) {
  try { return storage?.getItem(GUIDE_KEY) === '1'; } catch { return false; }
}
export function writeDismissed(value, storage = globalThis.localStorage) {
  try { if (value) storage?.setItem(GUIDE_KEY, '1'); else storage?.removeItem(GUIDE_KEY); } catch { /* not persisted */ }
}
