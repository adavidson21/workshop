// Builds vendor/codemirror.js: CodeMirror 6 and the code languages Folio's editor uses, as one ES module.
// The site loads only files from itself (CSP script-src 'self'), so the editor is vendored, not fetched.
//
//   cd scripts/editor && npm install && cd ../.. && node scripts/build-editor.mjs
//
// Commit the result. js/editor.js loads it; without it, Folio falls back to a plain textarea.
import { build } from './editor/node_modules/esbuild/lib/main.js';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'vendor', 'codemirror.js');
const pkg = JSON.parse(readFileSync(join(here, 'editor', 'node_modules', '@codemirror', 'view', 'package.json'), 'utf8'));
await build({
  entryPoints: [join(here, 'editor', 'entry.js')], bundle: true, format: 'esm', minify: true, target: 'es2020', outfile: out,
  legalComments: 'eof', banner: { js: `/* CodeMirror 6 (view ${pkg.version}) and language packages, MIT. Built by scripts/build-editor.mjs. */` }
});
console.log(`vendor/codemirror.js: ${(statSync(out).size / 1024).toFixed(0)} KB`);
