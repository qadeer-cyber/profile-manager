// Fail unless this Node process loaded better-sqlite3's Node prebuild (not an Electron rebuild).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.close();
const native = Object.keys(require.cache).find(p => p.includes('better-sqlite3') && p.endsWith('.node'));
const shown = (native || '').replaceAll('\\', '/');
console.log('node', process.versions.node);
console.log('modules', process.versions.modules);
console.log('better_sqlite3', native);
if (!shown.includes('/prebuilds/')) {
  console.error('expected the Node prebuild under prebuilds/, got', native);
  process.exit(1);
}
