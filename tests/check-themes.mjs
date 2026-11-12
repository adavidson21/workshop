#!/usr/bin/env node
// Checks that shared/theme.js (THEMES, SWATCH) matches shared/themes.css: same themes, same order,
// and each swatch uses the brand's --bg and --accent for that theme. Exit 1 on drift. Node 18+, no dependencies.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'shared/themes.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'shared/theme.js'), 'utf8');
const brandTokens = JSON.parse(fs.readFileSync(path.join(root, 'shared/brand/tokens.json'), 'utf8'));

// Run theme.js with just enough of a browser to read what it exports.
const store = {};
const sandbox = {
  window: {matchMedia: () => ({matches: false}), addEventListener() {}},
  localStorage: {getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; }},
  document: {documentElement: {dataset: {}}, querySelector: () => null},
  console,
};
vm.runInNewContext(js, sandbox);
const {THEMES, SWATCH} = sandbox.window.WorkshopTheme;

const errors = [];
const header = css.match(/^\s*themes:\s*(.+)$/m);
if (!header) errors.push('themes.css: missing the "themes:" line in the header comment.');
const cssThemes = header ? header[1].split(',').map(s => s.trim().split('=')) : [];
const jsThemes = Object.entries(THEMES).filter(([k]) => k !== 'system');

if (JSON.stringify(cssThemes.map(([k]) => k)) !== JSON.stringify(jsThemes.map(([k]) => k)))
  errors.push(`Theme keys or order differ.\n  themes.css: ${cssThemes.map(([k]) => k).join(', ')}\n  theme.js:   ${jsThemes.map(([k]) => k).join(', ')}`);
for (const [k, name] of cssThemes) {
  if (THEMES[k] && THEMES[k] !== name) errors.push(`${k}: name is "${name}" in themes.css but "${THEMES[k]}" in theme.js.`);
  // Colors come from the brand library copy (shared/brand/tokens.json): the swatch is that theme's --bg and garnet --accent.
  const brand = brandTokens.color[k];
  if (!brand) { errors.push(`${k}: the brand has no ${k} theme (shared/brand/tokens.json).`); continue; }
  const want = [brand['--bg'].hex, brand['--accent'].hex].map(s => s.toUpperCase());
  const have = (SWATCH[k] || []).map(s => s.toUpperCase());
  if (JSON.stringify(want) !== JSON.stringify(have)) errors.push(`${k}: swatch should be [${want}] (bg, accent), theme.js has [${have}].`);
}

if (errors.length) { console.error('Themes drifted:\n- ' + errors.join('\n- ')); process.exit(1); }
console.log(`themes ok: ${cssThemes.length} themes match`);
