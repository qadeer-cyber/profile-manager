// Preview for "Bulk create from a proxy list". Pure (no React). It uses the same line parser, naming and duplicate rule
// as the server action, so every row shows what will happen. A row never contains the password.
import { parseProxyLine } from '../../../server/proxy-line.js';
import { formatBulkName, proxyDuplicateKey, BULK_PROXY_LINES_MAX } from '../../../server/bulk.js';

export { BULK_PROXY_LINES_MAX };

export function planBulkCreate({ text = '', defaultType = 'http', pattern = '', startAt = 1 } = {}) {
  // Same rule as the server: blank lines are dropped and numbering follows the remaining lines.
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const seen = new Set();
  const first = Number.isInteger(Number(startAt)) && Number(startAt) >= 1 ? Number(startAt) : 1;
  const rows = lines.map((line, index) => {
    const base = { index, line, name: formatBulkName(pattern, first + index) };
    try {
      const p = parseProxyLine(line, defaultType);
      const key = proxyDuplicateKey(p);
      const label = `${p.type}://${p.host}:${p.port}${p.username ? ` · ${p.username}` : ''}${p.password ? ' · password set' : ''}`;
      if (seen.has(key)) return { ...base, state: 'duplicate', label, message: 'Same proxy as an earlier line. It will be skipped.' };
      seen.add(key);
      return { ...base, state: 'ok', label, message: '' };
    } catch (error) {
      return { ...base, label: '', state: 'invalid', message: error.message };
    }
  });
  const counts = { total: rows.length, ok: 0, invalid: 0, duplicate: 0 };
  for (const r of rows) counts[r.state]++;
  const tooMany = rows.length > BULK_PROXY_LINES_MAX;
  const summary = !rows.length ? 'Paste one proxy per line.'
    : tooMany ? `Too many lines: ${rows.length}. The limit is ${BULK_PROXY_LINES_MAX} per batch.`
    : [`${counts.ok} profile${counts.ok === 1 ? '' : 's'} ready`, counts.invalid && `${counts.invalid} line${counts.invalid === 1 ? '' : 's'} not understood`, counts.duplicate && `${counts.duplicate} repeated`].filter(Boolean).join(' · ');
  return { rows, counts, tooMany, summary, canCreate: counts.ok > 0 && !tooMany };
}

// After a run: the lines that were not created, so the user can fix and run them again. `sent` is the list of rows that
// were sent (in order); the server numbers its items by position in that list.
export function remainingLines(sent, items) {
  const failed = new Set((items || []).filter(i => i.ok === false).map(i => i.index));
  return sent.filter((_, position) => failed.has(position)).map(r => r.line);
}
