// Fill build/bundled-browsers with the pinned, SHA-256-verified Chromium for the offline build.
// Usage: node scripts/fetch-bundled-chromium.mjs [win64|linux64]   (default win64)
import fs from 'fs'; import path from 'path';
import { installVerifiedChromium, chromiumStatus } from '../server/chromium.js';
const key = process.argv[2] || 'win64', root = path.resolve('build/bundled-browsers');
const st = chromiumStatus({ root, key });
if (st.chromium.verified && st['chromium-headless-shell'].verified) { console.log('bundled Chromium already present and verified:', root); process.exit(0); }
fs.rmSync(root, { recursive: true, force: true });
const r = await installVerifiedChromium({ root, key, log: m => console.log(m) });
for (const x of r) console.log(`ok ${x.name} -> ${x.dir} (sha256 ${x.sha256})`);
