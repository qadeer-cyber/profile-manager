import { db, getSetting, setSetting } from './db.js';
import { decrypt, encrypt } from './secrets.js';

const key = 'geoip-maxmind-credentials';
const environment = () => ({
  account: process.env.AZWAH_MAXMIND_ACCOUNT_ID,
  license: process.env.AZWAH_MAXMIND_LICENSE_KEY,
});

export function geoIpStatus() {
  if (getSetting(key, null)) return { configured: true, source: 'local' };
  const { account, license } = environment();
  return { configured: Boolean(account && license), source: account && license ? 'environment' : null };
}

export function geoIpCredentials() {
  const stored = getSetting(key, null);
  if (!stored) return environment();
  try { return JSON.parse(decrypt(stored)); }
  catch { throw Object.assign(new Error('Re-enter the GeoIP credentials in Settings.'), { status: 409, code: 'GEOIP_CREDENTIALS_UNAVAILABLE' }); }
}

export function saveGeoIpCredentials({ account, license }) {
  if (typeof account !== 'string' || !/^\d{1,20}$/.test(account.trim()) ||
      typeof license !== 'string' || !/^[!-~]{8,200}$/.test(license.trim())) {
    throw Object.assign(new Error('Enter a valid MaxMind account ID and license key.'), { status: 400, code: 'INVALID_GEOIP_CREDENTIALS' });
  }
  setSetting(key, encrypt(JSON.stringify({ account: account.trim(), license: license.trim() })));
  return geoIpStatus();
}

export function clearGeoIpCredentials() {
  db.prepare('DELETE FROM settings WHERE key=?').run(key);
  return geoIpStatus();
}
