// Row fields (row-fields-model.js): which optional fields task rows show. How rows use it is checked in a
// browser by test/e2e.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROW_FIELDS, ROW_GROUPS, ROW_KEEPS, cleanRowFields, rowShown, withHidden } from '../js/row-fields-model.js';

test('every field has a known group, a label and a unique key', () => {
  const keys = ROW_FIELDS.map(f => f.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const f of ROW_FIELDS){ assert.ok(ROW_GROUPS.includes(f.group), f.key); assert.ok(f.label, f.key); }
  for (const g of Object.keys(ROW_KEEPS)) assert.ok(ROW_GROUPS.includes(g), g);
  assert.ok(ROW_GROUPS.every(g => ROW_FIELDS.some(f => f.group === g)), 'no empty group');
});

test('cleanRowFields: anything odd reads as all shown; unknown keys are kept', () => {
  for (const v of [undefined, null, 'x', 3, {}, {hidden: 'score'}]) assert.deepEqual(cleanRowFields(v), {hidden: []});
  assert.deepEqual(cleanRowFields({hidden: ['score', 'score', 7, null, 'Bad Key', '', 'later-field']}), {hidden: ['score', 'later-field']});
  assert.equal(cleanRowFields({hidden: Array.from({length: 80}, (_, i) => 'k' + i)}).hidden.length, 50);
});

test('rowShown: hidden keys are off, everything else is on', () => {
  const on = rowShown(['due', 'score']);
  assert.equal(on('due'), false);
  assert.equal(on('score'), false);
  assert.equal(on('people'), true);
  assert.equal(rowShown(undefined)('due'), true);
});

test('withHidden: known fields come from the sheet, unknown keys already saved stay', () => {
  assert.deepEqual(withHidden({hidden: ['score', 'later-field']}, new Set(['people'])), {hidden: ['people', 'later-field']});
  assert.deepEqual(withHidden(undefined, new Set()), {hidden: []});
  assert.deepEqual(withHidden({hidden: ['score']}, new Set(['today', 'ado'])).hidden, ['ado', 'today'], 'in field order');
});
