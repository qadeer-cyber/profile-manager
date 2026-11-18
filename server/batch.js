// Sequential batch for the local automation API. One failure is recorded and the
// remaining operations still run. Results are redacted before they leave this module.
import { redactSecrets } from './jobs.js';

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

export async function runBatch(operations, handlers) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 25) throw fail(400, 'operations must be an array of 1 to 25 items', 'INVALID_BATCH');
  const results = [];
  for (let index = 0; index < operations.length; index += 1) {
    const op = operations[index] && typeof operations[index] === 'object' ? operations[index] : {};
    const name = typeof op.op === 'string' ? op.op : '';
    try {
      if (!name || typeof handlers[name] !== 'function') throw fail(400, 'operation is not supported', 'UNSUPPORTED_OPERATION');
      const value = await handlers[name](op);
      results.push({ index, op: name, ok: true, result: redactSecrets(value) });
    } catch (error) {
      results.push({ index, op: name || null, ok: false, status: error.status || 500, error: error.message || 'failed', code: error.code || null });
    }
  }
  return { ok: results.every(item => item.ok), results };
}
