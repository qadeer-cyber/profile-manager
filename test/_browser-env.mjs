// Resolve Chromium for real-browser tests: bundled offline tree, then Playwright cache.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { expectedExecutable } from '../server/chromium.js';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const bundledRoot = path.join(repoRoot, 'build', 'bundled-browsers');

function chromiumExeAt(root) {
  const exe = expectedExecutable('chromium', { root });
  return exe && fs.existsSync(exe) ? exe : null;
}

/** @returns {string|null} directory usable as PLAYWRIGHT_BROWSERS_PATH */
export function resolveBrowsersPath() {
  const fromEnv = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (fromEnv && fromEnv !== '0' && fromEnv !== 'default') {
    return chromiumExeAt(fromEnv) ? path.resolve(fromEnv) : null;
  }
  if (chromiumExeAt(bundledRoot)) return bundledRoot;
  const cached = expectedExecutable('chromium');
  return cached && fs.existsSync(cached) ? path.dirname(path.dirname(cached)) : null;
}

export function chromiumAvailableForTests() {
  return !!resolveBrowsersPath();
}

/** Merge env for suites that launch pinned CfT via the API. */
export function withBrowserTestEnv(env = {}) {
  const merged = {
    ...process.env,
    ...env,
    PM_AUTOMATION_DEFAULT: env.PM_AUTOMATION_DEFAULT ?? process.env.PM_AUTOMATION_DEFAULT ?? '1',
  };
  if (!merged.PLAYWRIGHT_BROWSERS_PATH || merged.PLAYWRIGHT_BROWSERS_PATH === 'default') {
    const root = resolveBrowsersPath();
    if (root) merged.PLAYWRIGHT_BROWSERS_PATH = root;
  }
  delete merged.PM_SECRET;
  return merged;
}
