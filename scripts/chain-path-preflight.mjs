// Windows path preflight for the Chromium chain. sccache writes cached build outputs with ordinary Win32 paths,
// which fail at 260 characters (run 44798415536 stage 2: an xnnpack object at exactly 260, os error 3).
// Reads `ninja -t targets all` from stdin, measures every output's full path under the build directory and
// fails closed: an empty or unreadable target list is an error, not a pass.
//
//   ninja -C <out> -t targets all | node scripts/chain-path-preflight.mjs <absolute out dir> [limit=250]

export const DEFAULT_LIMIT = 250;

export function outputsFromTargets(text) {
  const outputs = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    // "<output path>: <rule>", e.g. "obj/base/base/values.obj: cxx". Rule names have no spaces.
    const m = /^(\S.*?): [A-Za-z_][\w-]*$/.exec(line.trim());
    if (m) outputs.push(m[1]);
  }
  return outputs;
}

export function checkPaths(targetsText, outDir, limit = DEFAULT_LIMIT) {
  if (!/^[A-Za-z]:[\\/]/.test(outDir || '')) throw new Error('The build directory must be an absolute Windows path.');
  const outputs = outputsFromTargets(targetsText);
  if (!outputs.length) return { ok: false, reason: 'No build outputs were listed; cannot check path lengths.', count: 0 };
  const root = outDir.replace(/[\\/]+$/, '') + '\\';
  let longest = null;
  for (const rel of outputs) {
    const full = root + rel.replace(/\//g, '\\');
    if (!longest || full.length > longest.length) longest = { length: full.length, path: rel };
  }
  const ok = longest.length <= limit;
  return { ok, count: outputs.length, longest, limit,
    reason: ok ? null : `Build output path is ${longest.length} characters (limit ${limit}; Windows fails at 260): ${longest.path}. Use a shorter workspace path.` };
}

const isMain = process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href;
if (isMain) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const [outDir, limit] = process.argv.slice(2);
  try {
    const result = checkPaths(Buffer.concat(chunks).toString('utf8'), outDir, limit ? Number(limit) : DEFAULT_LIMIT);
    if (result.longest) console.log(`LONGEST_OUTPUT_PATH length=${result.longest.length} ${result.longest.path}`);
    console.log(`PATH_PREFLIGHT outputs=${result.count} ok=${result.ok}`);
    if (!result.ok) { console.error(result.reason); process.exit(1); }
  } catch (error) { console.error(error.message); process.exit(1); }
}
