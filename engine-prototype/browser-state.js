import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { navigationOrigin } from './config.js';

const max = { tabs: 20, bookmarks: 200, history: 300 };
function urls(values, limit) {
  return Array.isArray(values) ? values.filter(url => typeof url === 'string' && url.length <= 8192 && navigationOrigin(url)).slice(0, limit) : [];
}

export function openBrowserState(root) {
  const file = path.join(root, 'browser-state.json');
  let input = {};
  try {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024) throw new Error('Unsafe browser state file.');
    input = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const state = Object.fromEntries(Object.entries(max).map(([key, limit]) => [key, urls(input[key], limit)]));
  function update(patch) {
    const next = { ...state, ...patch };
    const clean = Object.fromEntries(Object.entries(max).map(([key, limit]) => [key, urls(next[key], limit)]));
    const temp = file + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temp, JSON.stringify(clean), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, file);
      Object.assign(state, clean);
    } finally { fs.rmSync(temp, { force: true }); }
  }
  return { state, update };
}
