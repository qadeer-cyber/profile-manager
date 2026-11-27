// Copy and actions for the empty tables on Proxies, Templates, Extensions and the Firefox library. Pure (no React).
// A filtered-empty table says so and offers to clear the filters; a truly empty one says what the page is for and
// offers the first useful action. Nothing here pretends data exists.
const clear = { id: 'clear-filters', label: 'Clear filters' };

export function emptyState(kind, { filtered = false, hasProfiles = false } = {}) {
  if (filtered) return { title: `No ${kind === 'proxies' ? 'proxies' : kind === 'templates' ? 'templates' : 'extensions'} match these filters.`, text: '', actions: [clear] };
  switch (kind) {
    case 'proxies':
      return { title: 'No proxies yet.', text: 'A proxy gives a profile its own network address. Add one, or import a list. To create one profile per proxy in one step, use “Bulk create from proxy list” on the Profiles page.',
        actions: [{ id: 'add', label: 'Add a proxy', primary: true }, { id: 'import', label: 'Import a list' }] };
    case 'templates':
      return hasProfiles
        ? { title: 'No templates yet.', text: 'A template is a reusable set of profile settings (engine, proxy, fingerprint). Save one from a profile you have already set up. Extensions are not copied.',
            actions: [{ id: 'create', label: 'Create from a profile', primary: true }] }
        : { title: 'No templates yet.', text: 'A template is saved from an existing profile, so create a profile first on the Profiles page.', actions: [] };
    case 'extensions':
      return { title: 'No extensions yet.', text: 'Import an unpacked extension folder that contains a manifest.json. AZWAH checks the manifest and shows the permissions it declares before you assign it to a profile. Firefox extensions are imported in the Firefox library below.',
        actions: [{ id: 'import-chromium', label: 'Import a Chromium extension', primary: true }] };
    case 'gecko':
      return { title: 'No Firefox extensions yet.', text: 'Import an unpacked folder or a Mozilla-signed .xpi. Unsigned extensions are not installed.', actions: [{ id: 'import-gecko', label: 'Import a Firefox extension', primary: true }] };
    default:
      return { title: 'Nothing here yet.', text: '', actions: [] };
  }
}
