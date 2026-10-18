// Run fn over items with limited concurrency; resolves to {ok, failed:[{item, error}]}.
export async function runAll(items, fn, limit = 3) {
  const failed = []; let i = 0, ok = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const it = items[i++]; try { await fn(it); ok++; } catch (e) { failed.push({ item: it, error: e.message }); } }
  }));
  return { ok, failed };
}
export const statusOf = p => p.running ? 'running' : p.last_error ? 'error' : 'stopped';
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
