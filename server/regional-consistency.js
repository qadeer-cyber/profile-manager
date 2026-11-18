// Regional facts a stock browser can actually show. This does not claim
// undetectability or agreement across every locale-sensitive API.

export function timezoneOffsetMinutes(timeZone, instant = new Date()) {
  if (typeof timeZone !== 'string' || !timeZone) throw new Error('timezone required');
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  if (!Number.isFinite(asUtc)) throw new Error(`cannot resolve offset for ${timeZone}`);
  // Date#getTimezoneOffset is UTC minus local wall time, in minutes.
  return Math.round((instant.getTime() - asUtc) / 60000);
}

export function assessLanguageList(expected, actual) {
  if (!Array.isArray(expected) || !expected.length) return { status: 'unavailable', issues: ['No language list is configured.'] };
  if (!Array.isArray(actual)) return { status: 'unavailable', issues: ['navigator.languages was not collected.'] };
  const exact = actual.length === expected.length && expected.every((tag, index) => actual[index] === tag);
  if (exact) return { status: 'pass', issues: [], extra: [] };
  const prefix = expected.every((tag, index) => actual[index] === tag);
  if (prefix) {
    const extra = actual.slice(expected.length);
    return { status: 'warning', issues: [`navigator.languages keeps the configured order and adds ${extra.join(', ')}.`], extra };
  }
  return {
    status: 'fail',
    issues: [`navigator.languages is ${actual.join(', ') || 'empty'}. The profile lists ${expected.join(', ')}.`],
    extra: [],
  };
}

// Stock Chromium may append the base language of a configured tag (en from en-US).
// That is still the configured list. An unrelated tag is not.
export function languageListMatchesStock(expected, actual) {
  const judged = assessLanguageList(expected, actual);
  if (judged.status === 'pass') return true;
  if (judged.status !== 'warning') return false;
  const bases = new Set(expected.map(tag => tag.split('-')[0].toLowerCase()));
  return judged.extra.every(tag => !tag.includes('-') && bases.has(tag.toLowerCase()));
}

export function assessAcceptLanguage(header, languages) {
  const tags = String(header || '')
    .split(',')
    .map(part => part.split(';')[0].trim())
    .filter(Boolean);
  if (!Array.isArray(languages) || !languages.length) return { status: 'unavailable', tags, issues: ['No language list is configured.'] };
  if (!tags.length) return { status: 'fail', tags, issues: ['Accept-Language was empty.'] };
  // Stock Chromium keeps the configured order and may insert the base language
  // of a regional tag (de after de-DE) at a lower q. An unrelated tag fails.
  let index = 0;
  for (const tag of tags) {
    const expected = languages[index];
    if (expected && tag.toLowerCase() === expected.toLowerCase()) {
      index += 1;
      continue;
    }
    const anchor = languages[index - 1] || expected || '';
    const base = anchor.split('-')[0].toLowerCase();
    if (base && !tag.includes('-') && tag.toLowerCase() === base) continue;
    return { status: 'fail', tags, issues: [`Accept-Language is ${tags.join(', ')}. The profile lists ${languages.join(', ')}.`] };
  }
  if (index !== languages.length) {
    return { status: 'fail', tags, issues: [`Accept-Language is ${tags.join(', ')}. The profile lists ${languages.join(', ')}.`] };
  }
  return { status: 'pass', tags, issues: [] };
}

export function assessRegionalObservation({ browserSettings = {}, observed = {} } = {}) {
  const issues = [];
  const timezoneId = browserSettings.timezoneId || '';
  const locale = browserSettings.locale || '';
  const languages = Array.isArray(browserSettings.languages) ? browserSettings.languages : [];
  if (timezoneId && observed.timezone !== timezoneId) issues.push(`timezone ${observed.timezone || 'missing'} != ${timezoneId}`);
  if (timezoneId && typeof observed.timezoneOffset === 'number') {
    let expected;
    try { expected = timezoneOffsetMinutes(timezoneId, observed.instant ? new Date(observed.instant) : new Date()); }
    catch { expected = null; }
    if (expected == null || observed.timezoneOffset !== expected) issues.push(`offset ${observed.timezoneOffset} != ${expected}`);
  } else if (timezoneId) issues.push('timezone offset was not collected');
  if (locale && observed.locale !== locale) issues.push(`navigator.language ${observed.locale || 'missing'} != ${locale}`);
  if (locale && observed.intlLocale && observed.intlLocale !== locale) issues.push(`Intl locale ${observed.intlLocale} != ${locale}`);
  const languagesJudged = assessLanguageList(languages, observed.languages);
  if (languages.length && languagesJudged.status === 'fail') issues.push(...languagesJudged.issues);
  if (observed.acceptLanguage != null) {
    const header = assessAcceptLanguage(observed.acceptLanguage, languages);
    if (header.status === 'fail') issues.push(...header.issues);
  }
  return { status: issues.length ? 'fail' : 'pass', issues };
}
