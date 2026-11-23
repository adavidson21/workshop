// The In Builds chip: where an ADO task stands on Builds' board, from Builds' summary (js/builds-link.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildsAbout, buildsLabel } from '../js/builds-link.js';

const env = (rows) => ({ schema: 'builds.summary', version: 1, items: [{ id: 'runs', kind: 'list', rows: [{ id: '7', route: 'item/x', note: 'Building' }] }, { id: 'tracked', kind: 'list', title: 'ADO items', rows }] });

test('buildsAbout: the tracked row for the ADO id, by string or number', () => {
  const e = env([{ id: '7', title: 'Export', route: 'item/w_1', note: 'Shape' }, { id: '77', title: 'Export', route: 'item/w_2', note: 'Source of #90' }]);
  assert.deepEqual(buildsAbout(e, 7), { column: 'Shape', route: 'item/w_1' });
  assert.deepEqual(buildsAbout(e, '77'), { column: 'Source of #90', route: 'item/w_2' });
  assert.equal(buildsAbout(e, 8), null);
  assert.equal(buildsLabel(buildsAbout(e, 7)), 'In Builds: Shape');
  assert.equal(buildsLabel({ column: '', route: 'r' }), 'In Builds');
  assert.equal(buildsLabel(null), '');
});

test('buildsAbout: nothing from a missing, foreign or older summary (no tracked card), or a row with no route', () => {
  assert.equal(buildsAbout(null, 7), null);
  assert.equal(buildsAbout({ schema: 'notes.summary', items: [] }, 7), null);
  assert.equal(buildsAbout({ schema: 'builds.summary', items: [{ id: 'runs', kind: 'list', rows: [{ id: '7', route: 'item/x' }] }] }, 7), null, 'runs alone is not the board');
  assert.equal(buildsAbout(env([{ id: '7', note: 'Shape' }]), 7), null);
  assert.equal(buildsAbout(env([]), undefined), null);
});
