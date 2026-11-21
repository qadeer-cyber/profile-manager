#!/usr/bin/env node
// FAKE native browser for launcher tests only: records its argv and whether AZWAH secrets reached it, then idles
// until terminated. Not a browser.
import fs from 'node:fs';
import path from 'node:path';
const dir = (process.argv.find(a => a.startsWith('--user-data-dir=')) || '').split('=')[1];
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'fake-launch.json'), JSON.stringify({ argv: process.argv.slice(2), pid: process.pid,
  secrets: ['PM_API_TOKEN', 'PM_SECRET', 'PM_UI_TOKEN', 'NODE_OPTIONS'].filter(k => k in process.env) }));
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1000);
