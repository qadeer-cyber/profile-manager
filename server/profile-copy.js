// Copy a stopped profile directory without following symlinks or lock files.
import fs from 'fs';
import path from 'path';
import { DATA_COPY_SKIP } from './browsers.js';

const unsafe = message => Object.assign(new Error(message), { status: 400, code: 'UNSAFE_PROFILE_LINK' });

export function copyProfileTree(src, dest, { skip = DATA_COPY_SKIP } = {}) {
  const root = path.resolve(src);
  const copy = (from, to) => {
    const base = path.basename(from);
    if (from !== root && skip.has(base)) return;
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink()) throw unsafe('Refusing to copy a profile that contains a symlink');
    if (stat.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const name of fs.readdirSync(from)) {
        if (skip.has(name)) continue;
        const child = path.resolve(from, name);
        if (child !== path.join(path.resolve(from), name) || (!child.startsWith(root + path.sep) && child !== root)) throw unsafe('Refusing to copy a profile path that escapes the profile');
        copy(child, path.join(to, name));
      }
      return;
    }
    if (stat.isFile()) fs.copyFileSync(from, to);
  };
  if (!fs.existsSync(root)) return;
  copy(root, path.resolve(dest));
}
