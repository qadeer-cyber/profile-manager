// Harvest open tab URLs from on-disk browser session files (native manual path).
import fs from 'fs';
import path from 'path';
import { eligibleTabUrl, MAX_RESTORED_TABS } from './tab-restore.js';

function collectFromText(text, urls) {
  if (typeof text !== 'string') return urls;
  const re = /https?:\/\/[^\s"'<>\\]{4,2048}/g;
  let m;
  while ((m = re.exec(text)) && urls.length < MAX_RESTORED_TABS) {
    const u = eligibleTabUrl(m[0]);
    if (u && !urls.includes(u)) urls.push(u);
  }
  return urls;
}

export function harvestChromiumTabUrls(chromiumUserDataDir) {
  const urls = [];
  for (const rel of ['Default/Last Session', 'Default/Current Session', 'Default/Preferences']) {
    const file = path.join(chromiumUserDataDir, rel);
    if (!fs.existsSync(file)) continue;
    try {
      if (rel.endsWith('Preferences')) {
        const prefs = JSON.parse(fs.readFileSync(file, 'utf8'));
        const stack = [prefs];
        while (stack.length && urls.length < MAX_RESTORED_TABS) {
          const node = stack.pop();
          if (!node || typeof node !== 'object') continue;
          if (typeof node.url === 'string') collectFromText(node.url, urls);
          for (const v of Object.values(node)) {
            if (v && typeof v === 'object') stack.push(v);
          }
        }
      } else {
        const buf = fs.readFileSync(file);
        collectFromText(buf.toString('utf8', 0, Math.min(buf.length, 800000)), urls);
      }
    } catch { /* unreadable session artifact */ }
  }
  return urls;
}

export function harvestFirefoxTabUrls(geckoProfileDir) {
  const urls = [];
  for (const name of ['sessionstore.json', 'sessionstore-backups/recovery.jsonl']) {
    const file = path.join(geckoProfileDir, name);
    if (!fs.existsSync(file)) continue;
    try {
      if (name.endsWith('.jsonl')) {
        const line = fs.readFileSync(file, 'utf8').split('\n').find(Boolean);
        if (line) collectFromText(line, urls);
        try {
          const parsed = JSON.parse(line);
          for (const win of parsed.windows || []) {
            for (const tab of win.tabs || []) {
              const entries = tab.entries || [];
              const last = entries[entries.length - 1];
              if (last?.url) collectFromText(last.url, urls);
            }
          }
        } catch { /* ignore */ }
      } else {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const win of parsed.windows || []) {
          for (const tab of win.tabs || []) {
            const entries = tab.entries || [];
            const last = entries[entries.length - 1];
            if (last?.url) collectFromText(last.url, urls);
          }
        }
      }
    } catch { /* ignore */ }
  }
  return urls;
}

export function harvestNativeTabUrls({ engine, chromiumDir, geckoDir }) {
  if (engine === 'firefox') return harvestFirefoxTabUrls(geckoDir);
  return harvestChromiumTabUrls(chromiumDir);
}
