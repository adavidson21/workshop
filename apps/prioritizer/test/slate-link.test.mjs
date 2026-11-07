// The In Slate chip: where an ADO task stands on Slate's board, from Slate's summary (js/slate-link.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slateAbout, slateLabel } from '../js/slate-link.js';

const env = (rows) => ({ schema: 'slate.summary', version: 1, items: [{ id: 'runs', kind: 'list', rows: [{ id: '7', route: 'item/x', note: 'Building' }] }, { id: 'tracked', kind: 'list', title: 'ADO items', rows }] });

test('slateAbout: the tracked row for the ADO id, by string or number', () => {
  const e = env([{ id: '7', title: 'Export', route: 'item/w_1', note: 'Shape' }, { id: '77', title: 'Export', route: 'item/w_2', note: 'Source of #90' }]);
  assert.deepEqual(slateAbout(e, 7), { column: 'Shape', route: 'item/w_1' });
  assert.deepEqual(slateAbout(e, '77'), { column: 'Source of #90', route: 'item/w_2' });
  assert.equal(slateAbout(e, 8), null);
  assert.equal(slateLabel(slateAbout(e, 7)), 'In Slate: Shape');
  assert.equal(slateLabel({ column: '', route: 'r' }), 'In Slate');
  assert.equal(slateLabel(null), '');
});

test('slateAbout: nothing from a missing, foreign or older summary (no tracked card), or a row with no route', () => {
  assert.equal(slateAbout(null, 7), null);
  assert.equal(slateAbout({ schema: 'notes.summary', items: [] }, 7), null);
  assert.equal(slateAbout({ schema: 'slate.summary', items: [{ id: 'runs', kind: 'list', rows: [{ id: '7', route: 'item/x' }] }] }, 7), null, 'runs alone is not the board');
  assert.equal(slateAbout(env([{ id: '7', note: 'Shape' }]), 7), null);
  assert.equal(slateAbout(env([]), undefined), null);
});
