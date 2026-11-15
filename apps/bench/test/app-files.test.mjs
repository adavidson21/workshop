// Bench is a whole app (apps/bench/): the manifest is valid, every file it lists exists, the page loads only files
// that exist, and the copy follows the house rules (no em dashes, tokens only in its CSS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SchemaSet } from '../../../tests/lib/schema.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'));
const schemas = SchemaSet.fromDir(join(ROOT, '..', '..', 'docs', 'schemas'));

test('app.json is a valid Workshop manifest for Bench', () => {
  assert.deepEqual(schemas.validate('app', app), []);
  assert.equal(app.id, 'bench');
  assert.deepEqual(app.connectors, [{ id: 'opencode', required: false }]);
  assert.equal(app.data, undefined, 'Bench stores nothing of its own');
});

test('every file app.json lists exists, and every js module is listed', () => {
  for (const f of app.files) assert.ok(existsSync(join(ROOT, f)), `${f} is listed but missing`);
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) assert.ok(existsSync(join(ROOT, m[1])), `index.html loads ${m[1]}, which is missing`);
  for (const f of app.files.filter((x) => x.startsWith('js/'))) {
    for (const m of readFileSync(join(ROOT, f), 'utf8').matchAll(/from '\.\/([a-z-]+\.js)'/g)) assert.ok(app.files.includes(`js/${m[1]}`), `js/${m[1]} is not in app.json files`);
  }
});

test('no em dashes anywhere in the app or its docs', () => {
  for (const f of ['README.md', 'index.html', 'app.json', ...app.files]) assert.equal(readFileSync(join(ROOT, f), 'utf8').includes('—'), false, `${f} has an em dash`);
});

test('bench.css uses semantic tokens: no raw colors, no gradients, no primitives', () => {
  const css = readFileSync(join(ROOT, 'bench.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false, 'raw hex color');
  assert.equal(/rgba?\(/.test(css), false, 'raw rgb color');
  assert.equal(/gradient/.test(css), false, 'gradient');
  assert.equal(/var\(--p-/.test(css), false, 'brand primitive');
});

test('the page has one primary action per view in its static markup, and the CSP of the shell', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /data-app-color="bench"/);
  assert.match(html, /Content-Security-Policy" content="default-src 'self'; script-src 'self';/);
  assert.equal((html.match(/btn primary/g) || []).length, 1, 'only the confirm dialog has a primary button in the page itself');
});
