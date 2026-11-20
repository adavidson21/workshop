// Areas (docs/apps.md, Areas): the pure helpers the agent, the shell, the SDK and Settings share.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AREAS, AREA_IDS, cleanAreas, areaHiding, appsOffBy, partOn } from '../areas.js';

test('every area names its apps, pages, connectors and parts', () => {
  assert.deepEqual(AREA_IDS, ['management', 'work']);
  for (const id of AREA_IDS) for (const k of ['label', 'about', 'apps', 'pages', 'connectors', 'parts']) assert.ok(k in AREAS[id], `${id}.${k}`);
  assert.ok(AREAS.management.apps.includes('receipts'), 'Rapport is management');
});

test('cleanAreas keeps known ids only', () => {
  assert.deepEqual([...cleanAreas(['work', 'nope', 7, 'work'])], ['work']);
  assert.deepEqual([...cleanAreas('work')], []);
});

test('what an area off hides', () => {
  const off = new Set(['management']);
  assert.equal(areaHiding('apps', 'receipts', off), 'management');
  assert.equal(areaHiding('apps', 'runway', off), '');
  assert.equal(areaHiding('pages', 'people', off), 'management');
  assert.equal(areaHiding('connectors', 'ado', new Set(['work'])), 'work');
  assert.deepEqual([...appsOffBy(new Set(AREA_IDS))].sort(), ['receipts', 'runway']);
  assert.equal(partOn('prioritizer', 'people', off), false);
  assert.equal(partOn('prioritizer', 'people', new Set()), true);
  assert.equal(partOn('notes', 'people', off), true);
});
