#!/usr/bin/env node
// FAKE browser for harness unit tests only. Behaves like the parts of Chromium the smoke harness touches:
// --version, --user-data-dir, loads the last URL argument once, "localStorage" kept in a file in the profile,
// exits 0 on SIGTERM. Mode via AZWAH_FAKE_BROWSER: "lose-data" never persists; "hang" ignores SIGTERM.
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('Fake Chromium 159.0.8153.0'); process.exit(0); }
const dir = (args.find(a => a.startsWith('--user-data-dir=')) || '').split('=')[1];
const url = args.filter(a => /^https?:/.test(a)).pop();
const store = path.join(dir, 'fake-local-storage.json');
const mode = process.env.AZWAH_FAKE_BROWSER || '';
const before = fs.existsSync(store) ? JSON.parse(fs.readFileSync(store, 'utf8')).value : null;
const key = new URL(url).pathname.slice(1);
await fetch(new URL(`/report?key=${key}&value=${encodeURIComponent(before || 'new')}`, url));
let pending = before ? null : 'kept';
process.on('SIGTERM', () => {
  if (mode === 'hang') return;
  if (pending && mode !== 'lose-data') fs.writeFileSync(store, JSON.stringify({ value: pending }));
  process.exit(0);
});
setInterval(() => {}, 1000);
