import path from 'node:path';
import { refreshDbipDatabase } from '../server/dbip-location.js';
// Both free DB-IP Lite datasets ship with the installer (CC BY 4.0, https://db-ip.com/): city for proxy
// location and ASN for the proxy exit network owner. The app refreshes them monthly in its data folder.
const root = path.resolve(process.argv[2] || 'build');
const city = await refreshDbipDatabase(path.join(root, 'geoip-dbip'));
console.log(`DB-IP City Lite ${city.month}, SHA-256 ${city.sha256}, CC BY 4.0 (https://db-ip.com/)`);
const asn = await refreshDbipDatabase(path.join(root, 'geoip-dbip-asn'), undefined, 'asn');
console.log(`DB-IP ASN Lite ${asn.month}, SHA-256 ${asn.sha256}, CC BY 4.0 (https://db-ip.com/)`);
