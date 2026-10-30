// Import before modules with database side effects. Each test file is a separate process.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
const previous = process.env.PM_DATA_DIR;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-isolated-test-'));
process.env.PM_DATA_DIR = dir;
after(async () => {
  if (fs.existsSync(path.join(dir, 'profiles.db'))) {
    const { db } = await import('../server/db.js');
    if (db.open) db.close();
  }
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  if (previous === undefined) delete process.env.PM_DATA_DIR;
  else process.env.PM_DATA_DIR = previous;
});
