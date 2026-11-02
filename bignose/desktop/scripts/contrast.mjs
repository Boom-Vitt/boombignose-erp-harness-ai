// Contrast gate for tokens.css. Run: node contrast.mjs [path/to/style.css]   (exits 1 on any failure)
// Checks every text pair the UI uses (WCAG AA 4.5:1), control borders, focus ring and graphics (3:1),
// on the single night-ledger theme (translucent glass surfaces are composited on --bg).
import { readFileSync } from 'node:fs';

const css = readFileSync(process.argv[2] ?? new URL('./tokens.css', import.meta.url), 'utf8');
const vars = (body) => Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
const block = (re, label) => { const m = re.exec(css); if (!m) throw new Error(`missing ${label} block`); return vars(m[1]); };
const night = block(/^:root \{([\s\S]*?)\n\}/m, 'night :root');

let failed = 0;
const fail = (msg) => { failed++; console.log(`FAIL ${msg}`); };

const parse = (c) => {
  const hex = /^#([0-9a-f]{6})$/i.exec(c);
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
  const rgb = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(c);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3], rgb[4] === undefined ? 1 : +rgb[4]];
  throw new Error(`cannot parse colour ${c}`);
};
const over = (top, base) => top.slice(0, 3).map((v, i) => v * top[3] + base[i] * (1 - top[3])).concat(1);
const lum = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
  .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
if (Math.abs(ratio([0, 0, 0, 1], [255, 255, 255, 1]) - 21) > 0.01) throw new Error('contrast maths is wrong');

const TEXT = ['text', 'muted', 'faint'];
const SURFACES = ['bg', 'sidebar', 'surface', 'raised', 'bubble', 'code-bg', 'code-inline', 'select', 'hover@sidebar', 'hover@surface'];
const pairs = [
  ...TEXT.flatMap(t => SURFACES.map(s => [t, s, 4.5])),
  ...['text', 'muted'].flatMap(t => ['accent-soft', 'ok-soft', 'warn-soft', 'bad-soft'].map(s => [t, s, 4.5])),
  ...['bg', 'sidebar', 'surface', 'raised', 'accent-soft'].map(s => ['accent-text', s, 4.5]),
  ...['ok', 'warn', 'bad'].flatMap(t => ['bg', 'surface', 'raised'].map(s => [t, s, 4.5])),
  ['ok', 'ok-soft', 4.5], ['warn', 'warn-soft', 4.5], ['bad', 'bad-soft', 4.5],
  ['accent-ink', 'accent', 4.5], ['accent-ink', 'accent-hover', 4.5], ['accent-ink', 'accent-press', 4.5],
  ['bg', 'text', 4.5], // stop button: bg-coloured icon on a text-coloured circle
  ...['bg', 'sidebar', 'surface', 'raised'].map(s => ['line-strong', s, 3]),
  ...['bg', 'sidebar', 'surface', 'raised', 'bubble', 'select'].map(s => ['accent', s, 3]), // focus ring, active tab underline
  ['bot-ink', 'bot-face', 3], ['bot-gear', 'bot-bg', 3],
];

for (const [name, t] of Object.entries({ night })) {
  const color = (key) => {
    const [k, base] = key.split('@');
    if (!(k in t)) throw new Error(`unknown token --${k}`);
    const c = parse(t[k]);
    return base ? over(c, color(base)) : c[3] < 1 ? over(c, parse(t.bg)) : c;
  };
  let worst = [Infinity, ''];
  for (const [fg, bg, min] of pairs) {
    const r = ratio(color(fg), color(bg));
    if (r < worst[0]) worst = [r, `${fg} on ${bg}`];
    if (r < min) fail(`${name}: ${fg} on ${bg} = ${r.toFixed(2)} (needs ${min})`);
  }
  console.log(`${name}: ${pairs.length} pairs, weakest ${worst[1]} = ${worst[0].toFixed(2)}`);
}
console.log(failed ? `${failed} failure(s)` : 'contrast: all pairs pass');
process.exit(failed ? 1 : 0);
