#!/usr/bin/env node
// Checks that shared/theme.js (THEMES, SWATCH) matches shared/themes.css: same themes, same order,
// and each swatch uses that theme's --bg and --accent. Exit 1 on drift. Node 18+, no dependencies.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'shared/themes.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'shared/theme.js'), 'utf8');

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
  const rule = css.match(new RegExp(`\\[data-theme=${k}\\]\\s*\\{([^}]*)\\}`));
  if (!rule) { errors.push(`${k}: no [data-theme=${k}] rule in themes.css.`); continue; }
  const v = n => (rule[1].match(new RegExp(`--${n}:\\s*([^;]+)`)) || [])[1];
  const want = [v('bg'), v('accent')].map(s => s && s.trim().toUpperCase());
  const have = (SWATCH[k] || []).map(s => s.toUpperCase());
  if (JSON.stringify(want) !== JSON.stringify(have)) errors.push(`${k}: swatch should be [${want}] (bg, accent), theme.js has [${have}].`);
}

if (errors.length) { console.error('Themes drifted:\n- ' + errors.join('\n- ')); process.exit(1); }
console.log(`themes ok: ${cssThemes.length} themes match`);
