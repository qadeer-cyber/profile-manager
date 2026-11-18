const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const profileId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function validateProfileId(value) {
  if (typeof value !== 'string' || !profileId.test(value)) throw new Error('A profile UUID is required.');
  return value.toLowerCase();
}

export function validateEngineConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['version', 'timezone', 'location', 'geolocationOrigin'].includes(key)) ||
      input.version !== 1) throw new Error('Unsupported engine profile configuration.');
  const timezone = input.timezone ?? null;
  if (timezone !== null && (typeof timezone !== 'string' || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$/.test(timezone))) {
    throw new Error('An IANA timezone is required.');
  }
  if (timezone) new Intl.DateTimeFormat('en', { timeZone: timezone });
  const location = input.location ?? null;
  if (location && (!finite(location.latitude, -90, 90) || !finite(location.longitude, -180, 180) ||
      !finite(location.accuracy, 1, 20000000))) throw new Error('Coordinates require a valid accuracy radius in meters.');
  const origin = input.geolocationOrigin ?? null;
  if (origin !== null && (!location || typeof origin !== 'string' || navigationOrigin(origin, true) !== origin)) {
    throw new Error('A coordinate override and exact secure origin are required to grant geolocation.');
  }
  return { timezone, location: location && { latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy }, origin };
}

export function navigationOrigin(value, allowLoopback = false) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol === 'https:' || (allowLoopback && url.protocol === 'http:' && url.hostname === '127.0.0.1')) return url.origin;
  } catch { /* invalid URL */ }
  return null;
}

export function permitsGeolocation(config, requestingOrigin, mainFrameOrigin) {
  return Boolean(config.origin && requestingOrigin === config.origin && mainFrameOrigin === config.origin);
}
