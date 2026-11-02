// Copies Docket's web files into mobile/www/ for the Android app, with the same layout as the site, so every
// relative path in Docket works unchanged:
//
//   www/index.html   Docket
//   www/js/          Docket's modules
//   www/shared/      the SDK, device storage, themes, fonts and SheetJS (copied from Workshop)
//   www/icons/       favicons
//
// Left out on purpose: tests, the desktop-only ADO helper, sw.js (the app ships its files, so a cached copy
// would only go stale) and the web app manifest. Then every local file a page or module refers to is checked,
// so a missing file fails the build instead of the app.
//
//   node mobile/scripts/build-web.mjs        (run from anywhere; `npm run build:web` in mobile/)
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(MOBILE, '..');
const WWW = join(MOBILE, 'www');

// Everything the app gets, relative to the repo root.
export const COPY = ['index.html', 'app.css', 'icon.svg', 'js', 'shared', 'icons'];

export function build({ repo = REPO, www = WWW } = {}) {
  rmSync(www, { recursive: true, force: true });
  mkdirSync(www, { recursive: true });
  for (const from of COPY) cpSync(join(repo, from), join(www, from), { recursive: true });
  // Docket's page without the web app manifest (an installed site's file; the app has its own), drawn edge to
  // edge behind the status and gesture bars (the page keeps clear of them with the safe-area insets).
  const page = join(www, 'index.html');
  let html = readFileSync(page, 'utf8').replace(/^\s*<link rel="manifest"[^>]*>\n/m, '');
  html = html.replace('<meta name="viewport" content="width=device-width, initial-scale=1">', '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
  if (!html.includes('viewport-fit=cover')) throw new Error('Docket\'s viewport meta tag changed; update build-web.mjs.');
  writeFileSync(page, html);
  const missing = checkRefs(www);
  if (missing.length) throw new Error('Docket refers to files the app does not have:\n' + missing.map(m => `  ${m}`).join('\n'));
  return { www, files: walk(www).length };
}

function walk(dir) {
  return readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}

// A file's text without comments, so usage examples in comments are not taken for references.
function code(file, ext) {
  const text = readFileSync(file, 'utf8');
  if (ext === '.html') return text.replace(/<!--[\s\S]*?-->/g, '');
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// Every relative src/href in HTML, url() in CSS, and import in JS must name a file under www/.
export function checkRefs(www) {
  const missing = [];
  const patterns = {
    '.html': [/\b(?:src|href)="([^"#?]+)"/g],
    '.css': [/url\(\s*['"]?([^'")#?]+)['"]?\s*\)/g],
    '.js': [/\bfrom\s+'([^']+)'/g, /\bimport\(\s*'([^']+)'\s*\)/g, /\bnew URL\(\s*'([^']+)',\s*import\.meta\.url\s*\)/g]
  };
  for (const file of walk(www)) {
    const ext = file.slice(file.lastIndexOf('.'));
    for (const re of patterns[ext] || []) {
      for (const [, ref] of code(file, ext).matchAll(re)) {
        if (/^(?:[a-z]+:|\/\/|data:)/i.test(ref) || ref.startsWith('/')) continue; // not a local file
        const target = resolve(dirname(file), ref);
        if (!target.startsWith(www)) { missing.push(`${relative(www, file)} -> ${ref} (outside the app)`); continue; }
        if (ref.endsWith('/') ? !existsSync(join(target, 'index.html')) : !existsSync(target)) missing.push(`${relative(www, file)} -> ${ref}`);
      }
    }
  }
  return missing;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { www, files } = build();
  console.log(`Docket web files ready: ${files} files in ${relative(process.cwd(), www) || '.'}`);
}
