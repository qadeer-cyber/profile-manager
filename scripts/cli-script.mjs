/** Declarative local API scripts for pm-cli. Bindings are {{stepId.field}} only. */

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function fail(message) {
  throw Object.assign(new Error(message), { exitCode: 2 });
}

export function interpolate(value, saved) {
  if (typeof value === 'string') {
    return value.replace(/\{\{([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\}\}/g, (_, id, field) => {
      const row = saved[id];
      if (!row || typeof row !== 'object' || row[field] == null) fail(`Unknown binding {{${id}.${field}}}`);
      return String(row[field]);
    });
  }
  if (Array.isArray(value)) return value.map(item => interpolate(item, saved));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = interpolate(item, saved);
    return out;
  }
  return value;
}

export async function executeCliScript(doc, api) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.steps)) fail('script must be an object with a steps array');
  if (doc.steps.length < 1 || doc.steps.length > 30) fail('script must contain 1 to 30 steps');
  const saved = {};
  const results = [];
  for (let index = 0; index < doc.steps.length; index += 1) {
    const step = doc.steps[index];
    const id = step?.id || `step${index + 1}`;
    const method = String(step?.method || '').toUpperCase();
    if (!METHODS.has(method)) fail(`step ${id}: method must be GET, POST, PUT, PATCH, or DELETE`);
    const rawPath = interpolate(step.path, saved);
    if (typeof rawPath !== 'string' || !rawPath.startsWith('/') || rawPath.startsWith('//')) fail(`step ${id}: path must start with /`);
    const body = step.body === undefined ? undefined : interpolate(step.body, saved);
    const ui = step.ui === true;
    let value;
    try {
      value = await api(method, rawPath, body, { ui });
    } catch (error) {
      error.message = `step ${id}: ${error.message}`;
      throw error;
    }
    if (step.save) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(step.save)) fail(`step ${id}: save id is invalid`);
      if (!value || typeof value !== 'object') fail(`step ${id}: cannot save an empty result`);
      saved[step.save] = value;
    }
    results.push({ id, ok: true, body: value });
  }
  return { ok: true, name: typeof doc.name === 'string' ? doc.name : null, results };
}
