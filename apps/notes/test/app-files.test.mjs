// The repo is a whole app: the manifest is valid, every file it lists exists, the page loads only files that
// exist here, and the service worker's version follows app.json's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SchemaSet } from './workshop/schema.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'));
const schemas = SchemaSet.fromDir(join(ROOT, 'test', 'workshop', 'schemas'));

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

test('the service worker version is app.json\'s version', () => {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  assert.match(sw, new RegExp(`version: '${app.version.replace(/\./g, '\\.')}'`));
});

test('no em dashes anywhere in the app or its docs', () => {
  for (const f of ['README.md', 'index.html', 'notes.css', 'app.json', ...app.files.filter(f => f.startsWith('js/'))]) {
    assert.equal(readFileSync(join(ROOT, f), 'utf8').includes('—'), false, `${f} has an em dash`);
  }
});
