// Guards the colour tokens that axe flagged (WCAG AA, 4.5:1 for normal text) so a later edit cannot bring them back.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../web/src/flightdeck.css', import.meta.url), 'utf8');
const block = (start, end) => css.slice(css.indexOf(start), css.indexOf(end));
const expand = hex => (hex.length === 4 ? '#' + [...hex.slice(1)].map(c => c + c).join('') : hex).toLowerCase();
const tokens = text => Object.fromEntries([...text.matchAll(/--([a-z0-9-]+):(#(?:[0-9a-f]{6}|[0-9a-f]{3}))\b/gi)].map(m => [m[1], expand(m[2])]));
const light = tokens(block(':root,[data-theme=light],.app.shell{', '[data-theme=dark]'));
const dark = tokens(block('[data-theme=dark],[data-theme=dark] .app.shell{', '/* ---------- type'));
const lum = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test('light theme: muted text, status text and notice text meet 4.5:1 on the surfaces they sit on', () => {
  for (const bg of ['surface', 'surface-2', 'hover', 'warn-soft', 'ok-soft', 'accent-soft']) {
    assert.ok(ratio(light['text-3'], light[bg]) >= 4.5, `text-3 on ${bg}: ${ratio(light['text-3'], light[bg]).toFixed(2)}`);
  }
  assert.ok(ratio(light.ok, light['ok-soft']) >= 4.5, 'ok on ok-soft (Ready pills, Running status)');
  assert.ok(ratio(light.bad, light['bad-soft']) >= 4.5, 'bad on bad-soft (Error status)');
  assert.ok(ratio(light.warn, light['warn-soft']) >= 4.5, 'warn on warn-soft (Mismatch pills, banners)');
  assert.ok(ratio(light['accent-text'], light['accent-soft']) >= 4.5, 'accent-text on accent-soft');
  assert.ok(ratio(light['text-2'], light['surface-2']) >= 4.5, 'text-2 on surface-2');
});

test('dark theme: muted and status text meet 4.5:1', () => {
  for (const bg of ['surface', 'surface-2', 'accent-soft', 'warn-soft']) {
    assert.ok(ratio(dark['text-2'], dark[bg]) >= 4.5, `text-2 on ${bg}: ${ratio(dark['text-2'], dark[bg]).toFixed(2)}`);
  }
  assert.ok(ratio(dark.ok, dark['ok-soft']) >= 4.5, 'ok on ok-soft');
  assert.ok(ratio(dark.bad, dark['bad-soft']) >= 4.5, 'bad on bad-soft');
  assert.ok(ratio(dark.warn, dark['warn-soft']) >= 4.5, 'warn on warn-soft');
});

test('the page declares its language', () => {
  assert.match(fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8'), /<html lang="en">/);
});
