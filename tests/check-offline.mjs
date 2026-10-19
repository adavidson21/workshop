#!/usr/bin/env node
// Checks that the installed app works offline: everything the shell page and each app's page load is
// precached by sw.js. The shell and shared/ must be in CORE in sw.js; an app's own files must be its entry,
// its icon, or listed in its app.json "files" (sw.js caches those from the app registry). ES module imports
// are followed, so every module an app imports is covered too. Also checks that every listed file exists.
// Exit 1 if not. Node 22, no dependencies.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = f => path.relative(root, f).split(path.sep).join('/');
const errors = [];

// Evaluate sw.js with stub worker globals to read CORE.
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const ctx = { self: { addEventListener() {}, location: new URL('https://x/sw.js') }, caches: {}, location: { origin: 'https://x' }, fetch() {}, Request: class {}, Response: {}, URL };
vm.runInNewContext(sw + '\nthis.__CORE = CORE;', ctx);
const norm = u => u.replace(/^\.\//, '').replace(/^$/, 'index.html').replace(/\/$/, '/index.html');
const core = new Set(ctx.__CORE.map(norm));
for (const u of ctx.__CORE) if (!fs.existsSync(path.join(root, norm(u)))) errors.push(`sw.js CORE lists ${u}, which does not exist.`);

// Apps, from the static registry (the shell and sw.js read the same list; CI checks it is current).
const registry = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'registry.json'), 'utf8'));
const pages = [{ page: 'index.html', owned: null }];
for (const a of registry.apps) {
  const base = a.base.replace(/^\//, '');
  const m = a.manifest;
  const owned = new Set([base + (m.entry || 'index.html'), base + (m.icon || 'icon.svg'), ...(m.files || []).map(f => base + f)]);
  for (const f of owned) if (!fs.existsSync(path.join(root, f))) errors.push(`${base}app.json lists ${f.slice(base.length)}, which does not exist.`);
  pages.push({ page: base + (m.entry || 'index.html'), base, owned, id: m.id });
}

function covered(file, app) {
  if (app && file.startsWith(app.base)) {
    if (!app.owned.has(file)) errors.push(`${app.page} needs ${file}; add "${file.slice(app.base.length)}" to "files" in ${app.base}app.json.`);
  } else if (!core.has(file)) errors.push(`${app ? app.page : 'index.html'} needs ${file}; add ./${file} to CORE in sw.js.`);
}

// Follow static imports from a module, recursively.
function walkModule(file, app, seen) {
  if (seen.has(file)) return;
  seen.add(file);
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) { errors.push(`${file} is imported but does not exist.`); return; }
  covered(file, app);
  const src = fs.readFileSync(abs, 'utf8');
  for (const m of src.matchAll(/^(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|^import\s*['"]([^'"]+)['"]/gm)) {
    const spec = m[1] || m[2];
    if (!spec.startsWith('.')) continue;
    walkModule(rel(path.resolve(path.dirname(abs), spec)), app, seen);
  }
}

for (const p of pages) {
  const html = fs.readFileSync(path.join(root, p.page), 'utf8');
  const app = p.owned ? p : null;
  const seen = new Set();
  for (const m of html.matchAll(/<(script|link)\b([^>]*)>/g)) {
    const attrs = m[2];
    const ref = (attrs.match(/\s(?:src|href)="([^"]+)"/) || [])[1];
    if (!ref || /^(https?:)?\/\//.test(ref) || /\brel="(?:manifest|icon|apple-touch-icon)"/.test(attrs)) {
      if (ref && /\brel="(?:manifest|icon|apple-touch-icon)"/.test(attrs) && !fs.existsSync(path.join(root, path.dirname(p.page), ref))) errors.push(`${p.page} links ${ref}, which does not exist.`);
      continue;
    }
    const file = rel(path.resolve(root, path.dirname(p.page), ref));
    if (!fs.existsSync(path.join(root, file))) { errors.push(`${p.page} loads ${ref}, which does not exist.`); continue; }
    if (m[1] === 'script' && /\btype="module"/.test(attrs)) walkModule(file, app, seen);
    else covered(file, app);
  }
}

if (errors.length) { console.error('Offline cache list is out of date:\n- ' + [...new Set(errors)].join('\n- ')); process.exit(1); }
console.log(`offline ok: ${core.size} core files, ${registry.apps.length} apps, every page asset and module covered`);
