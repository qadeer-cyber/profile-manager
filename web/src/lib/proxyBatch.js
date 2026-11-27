// Tests many saved proxies with a bounded number in flight and live progress. Pure (the caller passes the function that
// tests one proxy), so node --test covers it. One request per proxy: a slow or dead proxy only holds one slot, progress is
// real, and cancelling stops starting new tests (tests already running finish and are stored).
export async function runProxyTests(ids, testOne, { concurrency = 5, onProgress = () => {}, shouldStop = () => false } = {}) {
  const queue = [...new Set(ids)];
  const state = { total: queue.length, done: 0, ok: 0, failed: [], cancelled: false };
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      if (shouldStop()) { state.cancelled = true; return; }
      const id = queue[next++];
      try {
        const result = await testOne(id);
        if (result && result.ok !== false && result.status !== 'failed') state.ok++;
        else state.failed.push({ id, error: result?.error || 'failed', message: result?.message || '' });
      } catch (error) {
        state.failed.push({ id, error: error?.code || 'error', message: error?.message || 'The test could not run.' });
      }
      state.done++;
      onProgress({ total: state.total, done: state.done, ok: state.ok, failed: state.failed.length });
    }
  };
  const lanes = Math.max(1, Math.min(Number.isInteger(concurrency) ? concurrency : 5, 10, queue.length || 1));
  await Promise.all(Array.from({ length: queue.length ? lanes : 0 }, worker));
  return state;
}

export function batchSummary({ total, done, ok, failed, cancelled }) {
  const bad = Array.isArray(failed) ? failed.length : failed;
  if (!total) return 'No proxies to test.';
  const head = cancelled ? `Stopped after ${done} of ${total}` : `Tested ${total}`;
  return `${head}: ${ok} working${bad ? `, ${bad} failing` : ''}.`;
}
