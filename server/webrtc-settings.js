// Launch-time WebRTC application. The command-line flag is checked with the same
// argument parser that reads a live process. The preference write is additive.
import fs from 'fs';
import path from 'path';
import { summarizeWebRtcArguments } from './diagnostic-process.js';
import { FORCED_WEBRTC_POLICIES } from './webrtc-policy.js';

export function verifyWebRtcLaunchArgs(args, mode) {
  const summary = summarizeWebRtcArguments(args);
  if (mode === 'browser_default') return summary.kind === 'absent';
  return summary.kind === 'present' && summary.value === mode;
}

// Merge webrtc.ip_handling_policy into Default/Preferences without replacing
// the rest of the file. Chromium may ignore an unsigned edit; the force flag
// remains the setting that launch verification checks.
export function applyWebRtcPreference(dir, mode) {
  if (!FORCED_WEBRTC_POLICIES.includes(mode)) return false;
  const root = path.resolve(dir);
  const prefDir = path.join(root, 'Default');
  const file = path.join(prefDir, 'Preferences');
  if (path.resolve(file) !== file || !file.startsWith(prefDir + path.sep)) {
    throw Object.assign(new Error('Refusing to write WebRTC preferences outside the profile'), { status: 500, code: 'WEBRTC_PREFERENCE_PATH' });
  }
  let prefs = {};
  if (fs.existsSync(file)) {
    try { prefs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return false; }
    if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return false;
  }
  const current = prefs.webrtc;
  const webrtc = current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
  webrtc.ip_handling_policy = mode;
  prefs.webrtc = webrtc;
  fs.mkdirSync(prefDir, { recursive: true });
  const tmp = file + '.pm-tmp';
  fs.writeFileSync(tmp, JSON.stringify(prefs));
  fs.renameSync(tmp, file);
  return true;
}
