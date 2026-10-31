// Copies Docket's web files into mobile/www/ for the Android app, with the same folder layout as the site,
// so every relative path in Docket works unchanged:
//
//   www/index.html          opens Docket (apps/prioritizer/)
//   www/apps/prioritizer/   Docket, without its tests and the desktop-only ADO helper
//   www/shared/             the SDK, device storage, themes, fonts and SheetJS
//   www/icons/              favicons
//
// Left out on purpose: sw.js (the app ships its files, so a cached copy would only go stale) and the web app
// manifest. Then every local file a page or module refers to is checked, so a missing file fails the build
// instead of the app.
//
//   node mobile/scripts/build-web.mjs        (run from anywhere; `npm run build:web` in mobile/)
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(MOBILE, '..');
const WWW = join(MOBILE, 'www');

const COPY = [
  { from: 'apps/prioritizer', skip: ['test', 'ado-helper', 'README.md'] },
  { from: 'shared', skip: ['test', 'screenshots'] },
  { from: 'icons', skip: [] }
];

export function build({ repo = REPO, www = WWW } = {}) {
  rmSync(www, { recursive: true, force: true });
  mkdirSync(www, { recursive: true });
  for (const { from, skip } of COPY) {
    const src = join(repo, from);
    cpSync(src, join(www, from), {
      recursive: true,
      filter: (p) => { const rel = relative(src, p); return !skip.some(s => rel === s || rel.startsWith(s + sep)); }
    });
  }
  // Docket's page without the web app manifest (an installed site's file; the app has its own).
  const page = join(www, 'apps/prioritizer/index.html');
  writeFileSync(page, readFileSync(page, 'utf8').replace(/^\s*<link rel="manifest"[^>]*>\n/m, ''));
  writeFileSync(join(www, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'">
<meta http-equiv="refresh" content="0; url=apps/prioritizer/">
<title>Docket</title>
</head>
<body><a href="apps/prioritizer/">Open Docket</a></body>
</html>
`);
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
