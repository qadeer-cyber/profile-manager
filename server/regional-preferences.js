// Chromium profile language list. Firefox uses user.js instead.
import fs from 'fs';
import path from 'path';
import { validateBrowserSettings } from './browser-settings.js';

function preferenceFile(dir) {
  const root = path.resolve(dir);
  const prefDir = path.join(root, 'Default');
  const file = path.join(prefDir, 'Preferences');
  if (path.resolve(file) !== file || !file.startsWith(prefDir + path.sep)) {
    throw Object.assign(new Error('Refusing to write preferences outside the profile'), { status: 500, code: 'PREFERENCE_PATH' });
  }
  return { prefDir, file };
}

// Writes intl.accept_languages so the ordered profile list is in the profile
// itself, not only on the command line. Empty languages leave the host default.
export function applyChromiumLanguagePreferences(dir, browserSettings) {
  const settings = validateBrowserSettings(browserSettings || {});
  if (!settings.languages.length) return false;
  const { prefDir, file } = preferenceFile(dir);
  let prefs = {};
  if (fs.existsSync(file)) {
    try { prefs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return false; }
    if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return false;
  }
  const intl = prefs.intl && typeof prefs.intl === 'object' && !Array.isArray(prefs.intl) ? prefs.intl : {};
  const next = settings.languages.join(',');
  if (intl.accept_languages === next) return false;
  prefs.intl = { ...intl, accept_languages: next };
  fs.mkdirSync(prefDir, { recursive: true });
  const tmp = file + '.pm-tmp';
  fs.writeFileSync(tmp, JSON.stringify(prefs));
  fs.renameSync(tmp, file);
  return true;
}
