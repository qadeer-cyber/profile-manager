// Bounded fan-out for bulk profile actions, and a strict CSV reader for imports.
const fail = message => Object.assign(new Error(message), { status: 400, code: 'INVALID_BULK' });

export function boundedConcurrency(value, fallback) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > 4) throw fail('concurrency must be an integer from 1 to 4');
  return value;
}

export async function mapPool(items, limit, fn, onItem) {
  const out = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try { out[index] = await fn(items[index], index); }
      catch (error) { out[index] = { ok: false, error: error.message, code: error.code || null }; }
      if (onItem) onItem(out[index], index);
    }
  };
  const workers = Math.min(Math.max(1, limit), items.length || 1);
  await Promise.all(Array.from({ length: items.length ? workers : 0 }, () => worker()));
  return out;
}

function parseCsv(text) {
  if (typeof text !== 'string' || !text.trim()) throw fail('csv must be a non-empty string');
  if (text.length > 500000) throw fail('csv is too large');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') {
      if (cell) throw fail('csv quoting is invalid');
      quoted = true;
      continue;
    }
    if (char === ',') { row.push(cell); cell = ''; continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }
  if (quoted) throw fail('csv quoting is invalid');
  if (cell !== '' || row.length) { row.push(cell); if (row.some(value => value !== '')) rows.push(row); }
  return rows;
}

const FORMULA = /^[=+\-@\t]/;
function safeCell(value, index, column) {
  const text = String(value ?? '').trim();
  if (FORMULA.test(text)) throw Object.assign(new Error(`row ${index + 1} column ${column} starts with a spreadsheet formula`), { status: 400, code: 'INVALID_BULK' });
  return text;
}
function splitList(value) { return value ? value.split('|').map(item => item.trim()).filter(Boolean) : []; }

export function profilesFromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw fail('csv must include a header and one row');
  if (rows.length > 101) throw fail('csv must contain at most 100 profiles');
  const header = rows[0].map(value => value.trim());
  if (!header.includes('name') || new Set(header).size !== header.length) throw fail('csv header must include name and unique columns');
  const allowed = new Set(['name', 'folder', 'tags', 'notes', 'locale', 'timezoneId', 'languages', 'startupUrls', 'proxyId']);
  if (header.some(column => !allowed.has(column))) throw fail('csv contains an unknown column');
  return rows.slice(1).map((row, index) => {
    if (row.length !== header.length) throw Object.assign(new Error(`row ${index + 2} has ${row.length} columns, expected ${header.length}`), { status: 400, code: 'INVALID_BULK' });
    const record = Object.fromEntries(header.map((column, columnIndex) => [column, safeCell(row[columnIndex], index + 1, column)]));
    const profile = { name: record.name, folder: record.folder || '', notes: record.notes || '', tags: splitList(record.tags || '') };
    if (record.proxyId) profile.proxyId = record.proxyId;
    const browserSettings = {};
    if (record.locale) browserSettings.locale = record.locale;
    if (record.timezoneId) browserSettings.timezoneId = record.timezoneId;
    if (record.languages) browserSettings.languages = splitList(record.languages);
    if (Object.keys(browserSettings).length) profile.browserSettings = browserSettings;
    if (record.startupUrls) profile.advancedSettings = { preferences: { startupUrls: splitList(record.startupUrls) } };
    return profile;
  });
}
