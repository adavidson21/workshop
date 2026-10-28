// Receipts' schemas (apps/receipts/schemas/) against synthetic fixtures, the default config, and what the app
// writes. Also guards the default rubric: Workshop ships its own generic rubric, never a company's review form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SchemaSet } from '../../../tests/lib/schema.mjs';
import { CSV_COLUMNS, DEFAULT_CATEGORIES, DEFAULT_ROLES, DEFAULT_RUBRIC, cleanEntry, defaultConfig, emptyEnvelope, entriesName, newEntry } from '../js/model.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const schemas = SchemaSet.fromDir(path.join(HERE, '..', 'schemas'));
const envSchemas = SchemaSet.fromDir(path.join(REPO, 'docs', 'schemas'));
const fixture = name => JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', name), 'utf8'));
const ok = (schema, value) => assert.deepEqual(schemas.validate(schema, value), [], `${schema}: ${schemas.validate(schema, value).join('; ')}`);
const okEnvelope = value => assert.deepEqual(envSchemas.validate('data-envelope', value), [], 'also a valid Workshop data envelope');

test('fixtures match their schemas and the Workshop data envelope', () => {
  for (const [schema, file] of [['config', 'config.json'], ['entries', 'entries-jordan-lee-2026.json'], ['metrics', 'metrics-jordan-lee-2026-09.json'], ['metrics', 'metrics-jordan-lee-2026-03.json']]) {
    const env = fixture(file);
    ok(schema, env);
    okEnvelope(env);
  }
});

test('the default config matches the schema and starts with you as self', () => {
  const env = defaultConfig({ today: '2026-10-28', selfName: 'Avery Quinn', now: 1 });
  ok('config', env);
  okEnvelope(env);
  assert.deepEqual(env.items.map(p => [p.id, p.relation, p.name]), [['me', 'self', 'Avery Quinn']]);
  assert.deepEqual(env.meta.cycles.map(c => c.id), ['2026-h1', '2026-h2']);
  assert.equal(env.meta.nudgeDays, 14);
});

test('schemas reject what they should', () => {
  const env = fixture('entries-jordan-lee-2026.json');
  const bad = structuredClone(env);
  bad.items[0].kind = 'brag';
  assert.ok(schemas.validate('entries', bad).length, 'unknown kind');
  const badLink = structuredClone(env);
  badLink.items[0].links = ['javascript:alert(1)'];
  assert.ok(schemas.validate('entries', badLink).length, 'only http(s) links');
  const tooMany = structuredClone(env);
  tooMany.items[0].rubric = ['results', 'craft', 'growth', 'ownership'];
  assert.ok(schemas.validate('entries', tooMany).length, 'at most 3 rubric sections');
  const wrongName = structuredClone(env);
  wrongName.schema = 'receipts.entries/Jordan/2026';
  assert.ok(schemas.validate('entries', wrongName).length, 'collection names are lowercase segments');
  const m = fixture('metrics-jordan-lee-2026-09.json');
  delete m.meta.month;
  assert.ok(schemas.validate('metrics', m).length, 'metrics meta names its month');
});

test('entries the app writes match the schema, with unknown fields kept', () => {
  const env = emptyEnvelope(entriesName('jordan-lee', 2026));
  const e = newEntry({ note: 'Fixed the flaky sync test.', rubric: ['craft', 'not-a-section'], links: ['https://example.com/x', 'ftp://nope'], impact: 9 }, '2026-10-28');
  env.items.push({ ...e, updatedAt: 1 });
  ok('entries', env);
  assert.deepEqual(e.links, ['https://example.com/x']);
  assert.equal(e.impact, null, 'out of range becomes empty');
  const kept = cleanEntry({ id: 'x', date: '2026-01-01', kind: 'win', note: 'n', futureField: { a: 1 } });
  assert.deepEqual(kept.futureField, { a: 1 }, 'fields from a newer Receipts are kept');
});

// TaskLedger's 9 rubric sections came from a company review form. They are named here only by SHA-256 (first 16
// hex digits of the lowercase words), so this repo holds no copy of them. "Communication" is generic and shared.
const COMPANY_SECTIONS = ['b5b471c61bb09942', '1b195c2eee811a9d', '0b97f52b84f257bb', '661559a2e0ec9f17', '063fe4bf363353a7',
  '9d9a67a66df1a022', '44cc8493305d2478', 'b82f8c0a951afc58'];
const SHARED_GENERIC = 'd4e16994df9002e5';
const key = s => crypto.createHash('sha256').update(String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).digest('hex').slice(0, 16);

test('the default rubric is Workshop\'s generic one, and none of TaskLedger\'s company sections come back', () => {
  assert.deepEqual(DEFAULT_RUBRIC.map(r => r.id), ['results', 'craft', 'ownership', 'collaboration', 'communication', 'leadership', 'growth']);
  const env = defaultConfig({ today: '2026-10-28' });
  const labels = [
    ...env.meta.rubric.flatMap(r => [r.id, r.name]),
    ...env.meta.roles.flatMap(r => [r.id, r.name]),
    ...Object.values(env.meta.categories).flat(),
    ...CSV_COLUMNS, ...DEFAULT_ROLES.map(r => r.name), ...Object.values(DEFAULT_CATEGORIES).flat()
  ];
  const hits = labels.filter(l => COMPANY_SECTIONS.includes(key(l)));
  assert.deepEqual(hits, [], 'a section name from the company form is in the defaults');
  assert.equal(env.meta.rubric.filter(r => key(r.name) === SHARED_GENERIC).length, 1, 'the guard hashes still match (Communication is found)');
});
