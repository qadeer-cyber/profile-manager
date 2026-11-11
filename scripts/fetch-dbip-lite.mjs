import path from 'node:path';
import { refreshDbipDatabase } from '../server/dbip-location.js';
const database = await refreshDbipDatabase(path.resolve(process.argv[2] || 'build/geoip-dbip'));
console.log(`DB-IP City Lite ${database.month}, SHA-256 ${database.sha256}, CC BY 4.0 (https://db-ip.com/)`);
