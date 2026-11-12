// Folio is a whole app (apps/notes/ in Workshop): the manifest is valid, every file it lists exists, and the page
// loads only files that exist (its own, or Workshop's shared files). Workshop's service worker caches it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SchemaSet } from '../../../tests/lib/schema.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'));
const schemas = SchemaSet.fromDir(join(ROOT, '..', '..', 'docs', 'schemas'));

test('app.json is a valid Workshop manifest for the notes app', () => {
  assert.deepEqual(schemas.validate('app', app), []);
  assert.equal(app.id, 'notes');
  assert.deepEqual(app.handoffs.sends, ['prioritizer', 'receipts']);
  assert.ok(app.data.includes('handoffs') && app.data.includes('summary') && app.data.includes('taken'));
});

test('every file app.json lists exists, and every js module is listed', () => {
  for (const f of app.files) assert.ok(existsSync(join(ROOT, f)), `${f} is listed but missing`);
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) assert.ok(existsSync(join(ROOT, m[1])), `index.html loads ${m[1]}, which is missing`);
  for (const m of readFileSync(join(ROOT, 'js', 'main.js'), 'utf8').matchAll(/from '\.\/([a-z-]+\.js)'/g)) assert.ok(app.files.includes(`js/${m[1]}`), `js/${m[1]} is not in app.json files`);
});

test('no em dashes anywhere in the app or its docs', () => {
  for (const f of ['README.md', 'index.html', 'notes.css', 'app.json', ...app.files.filter(f => f.startsWith('js/'))]) {
    assert.equal(readFileSync(join(ROOT, f), 'utf8').includes('—'), false, `${f} has an em dash`);
  }
});
