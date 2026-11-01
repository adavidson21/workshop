// app.json lists every file Docket's page needs (Workshop's service worker and Docket's own precache from it),
// and every local file the page and its modules refer to exists, so Docket runs on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SchemaSet } from './workshop/schema.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'));
const walk = (dir) => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

test('app.json lists every file under js/, shared/ and icons/', () => {
  const have = new Set(manifest.files);
  const need = ['js', 'shared', 'icons'].flatMap(d => walk(join(ROOT, d))).map(p => relative(ROOT, p).split('\\').join('/'))
    .filter(p => !/\.(txt|md)$/.test(p));
  assert.deepEqual(need.filter(p => !have.has(p)), [], 'missing from app.json files');
  assert.deepEqual(manifest.files.filter(f => !existsSync(join(ROOT, f))), [], 'listed but not in the repo');
});

test('app.json keeps the id Workshop and saved data use', () => {
  assert.equal(manifest.id, 'prioritizer');
  assert.equal(manifest.entry, 'index.html');
});

test('every local file the page and modules refer to exists, inside the repo', () => {
  const missing = [];
  const scan = (file, patterns) => {
    let text = readFileSync(file, 'utf8');
    text = file.endsWith('.html') ? text.replace(/<!--[\s\S]*?-->/g, '') : text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const re of patterns) for (const [, ref] of text.matchAll(re)) {
      if (/^(?:[a-z]+:|\/\/|data:|\$\{)/i.test(ref) || ref.startsWith('/')) continue;
      const target = resolve(dirname(file), ref);
      if (!target.startsWith(ROOT + '/') && target !== ROOT) missing.push(`${relative(ROOT, file)} -> ${ref} (outside the repo)`);
      else if (!existsSync(target)) missing.push(`${relative(ROOT, file)} -> ${ref}`);
    }
  };
  scan(join(ROOT, 'index.html'), [/\b(?:src|href)="([^"#?]+)"/g]);
  for (const f of walk(join(ROOT, 'js'))) scan(f, [/\bfrom\s+'([^']+)'/g, /\bimport\(\s*'([^']+)'\s*\)/g]);
  for (const f of walk(join(ROOT, 'shared')).filter(f => f.endsWith('.js'))) scan(f, [/\bfrom\s+'([^']+)'/g]);
  assert.deepEqual(missing, []);
});

test('app.json passes the manifest schema Workshop validates against (Workshop skips an app that fails it)', () => {
  const schemas = SchemaSet.fromDir(join(ROOT, 'test', 'workshop', 'schemas'));
  assert.deepEqual(schemas.validate('app', manifest), []);
});
