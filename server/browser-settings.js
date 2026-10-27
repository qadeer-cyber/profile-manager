// User-selected browser regional settings. Empty values retain browser/host defaults.
export const DEFAULT_BROWSER_SETTINGS = Object.freeze({ locale: '', timezoneId: '', languages: Object.freeze([]) });
const invalid = message => { throw Object.assign(new Error(message), { status: 400, code: 'INVALID_BROWSER_SETTINGS' }); };
function language(value, field) {
  if (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value)) invalid(`${field} must be a BCP 47 language tag`);
  try { return Intl.getCanonicalLocales(value)[0]; } catch { invalid(`${field} must be a BCP 47 language tag`); }
}
export function validateBrowserSettings(value, previous = DEFAULT_BROWSER_SETTINGS) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('browserSettings must be an object');
  if (Object.keys(value).some(k => !['locale', 'timezoneId', 'languages'].includes(k))) invalid('Unknown browserSettings field');
  const out = { ...previous, languages: [...previous.languages] };
  if ('locale' in value) out.locale = value.locale === '' ? '' : language(value.locale, 'locale');
  if ('timezoneId' in value) {
    if (typeof value.timezoneId !== 'string' || value.timezoneId.length > 100) invalid('timezoneId must be an IANA timezone or empty');
    const tz = value.timezoneId;
    if (tz && !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(tz)) invalid('timezoneId must be an IANA timezone');
    try { out.timezoneId = tz ? new Intl.DateTimeFormat('en', { timeZone: tz }).resolvedOptions().timeZone : ''; }
    catch { invalid('Unknown IANA timezone'); }
  }
  if ('languages' in value) {
    if (!Array.isArray(value.languages) || value.languages.length > 10) invalid('languages must contain at most 10 language tags');
    out.languages = value.languages.map(v => language(v, 'languages'));
    if (new Set(out.languages).size !== out.languages.length) invalid('languages must not contain duplicates');
  }
  if (out.locale && out.languages.length && out.languages[0] !== out.locale) invalid('The first preferred language must match locale');
  return out;
}
export function browserContextSettings(value = DEFAULT_BROWSER_SETTINGS) {
  const settings = validateBrowserSettings(value);
  const locale = settings.locale || settings.languages[0];
  return { ...(locale && !settings.languages.length ? { locale } : {}), ...(settings.timezoneId ? { timezoneId: settings.timezoneId } : {}) };
}
