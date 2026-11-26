// Bounded Ninja diagnostics for the Chromium chain: why are //base objects that were already built treated as
// dirty again (run 44798415536 stage 2 compiled obj/base/base/atl_throw.obj twice)? Hypothesis to test: Ninja
// lacks /showIncludes dependency records for compiles served from the sccache cache.
//
// Reads `ninja -n -d explain <target>` output (and `ninja -t deps <objects>`) from stdin and keeps only lines
// about the watched objects, capped, so the CI log stays small. Read-only: it never builds anything.
//
//   ninja -C out -n -d explain chrome 2>&1 | node scripts/chain-ninja-explain.mjs explain
//   ninja -C out -t deps obj/base/base/atl_throw.obj ... | node scripts/chain-ninja-explain.mjs deps

export const WATCHED = Object.freeze([
  'obj/base/base/atl_throw.obj',
  'obj/base/base/values.obj',
  'obj/base/base/page_size_win.obj',
  'obj/base/base/byte_size.obj',
]);
export const MAX_LINES = 40;

export function filterExplain(text, watched = WATCHED, max = MAX_LINES) {
  const out = [];
  let total = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.startsWith('ninja explain:')) continue;
    total++;
    if (watched.some(w => line.includes(w)) && out.length < max) out.push(line.slice(0, 300));
  }
  return { lines: out, explainLinesSeen: total, watchedFound: [...new Set(watched.filter(w => out.some(l => l.includes(w))))] };
}

// `ninja -t deps` prints "<target>: #deps N, deps mtime T (VALID|STALE)" followed by indented paths.
export function summarizeDeps(text, watched = WATCHED) {
  const summary = Object.fromEntries(watched.map(w => [w, 'not listed']));
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^(\S+): #deps (\d+), deps mtime (\d+) \((\w+)\)/.exec(line);
    if (m && m[1] in summary) summary[m[1]] = { deps: Number(m[2]), state: m[4] };
  }
  return summary;
}

const isMain = process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href;
if (isMain) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (process.argv[2] === 'deps') console.log('NINJA_DEPS ' + JSON.stringify(summarizeDeps(text)));
  else {
    const r = filterExplain(text);
    for (const line of r.lines) console.log(line);
    console.log('NINJA_EXPLAIN ' + JSON.stringify({ explainLinesSeen: r.explainLinesSeen, watchedFound: r.watchedFound }));
  }
}
