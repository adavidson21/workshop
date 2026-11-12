import test from 'node:test';
import assert from 'node:assert/strict';
import { blankDoc, cleanItem, fromEnvelope, levels, parentChoices, removeItem, setLane, setParent, toEnvelopeParts } from '../js/model.js';
import { parse, reconcile, serialize } from '../js/outline.js';
import { layout } from '../js/timeline.js';
import { pulled, applyLive } from '../js/ado/model.js';

const OUT = `# T
scale: month
start: 2027-01-01

## Lane A
- Epic one | Jan-Mar 2027
  The epic note.
  - Feature a | Jan 2027
    \\- a bullet note
    - Story x | 2027-01-05..2027-01-09
  - Feature b | Feb 2027
- Loose | Mar 2027
`;
const load = (text = OUT) => reconcile(blankDoc(), parse(text, { today: '2027-01-01' })).doc;
const by = (doc, t) => doc.items.find(i => i.title === t);

test('outline: indented "- " lines are children, "\\- " stays a note, and it round trips', () => {
  const doc = load();
  assert.equal(by(doc, 'Feature a').parent, by(doc, 'Epic one').id);
  assert.equal(by(doc, 'Story x').parent, by(doc, 'Feature a').id);
  assert.equal(by(doc, 'Loose').parent, null);
  assert.equal(by(doc, 'Feature a').notes, '- a bullet note');
  assert.equal(serialize(doc), OUT);
  const lv = levels(doc);
  assert.deepEqual(['Epic one', 'Feature a', 'Story x', 'Loose'].map(t => lv.get(by(doc, t).id)), [0, 1, 2, 0]);
});

test('outline: more than four levels deep is kept as text with a warning', () => {
  const p = parse('## L\n- a\n  - b\n    - c\n      - d\n        - e\n', { today: '2027-01-01' });
  assert.equal(p.entries.filter(e => e.kind === 'item').length, 4);
  assert.match(p.warnings[0].message, /nested more than 4 levels/);
});

test('parents: loops, other lanes and missing ones are cleared on load; removing moves children up', () => {
  const env = { meta: {}, items: [
    { id: 'l1', kind: 'lane', title: 'A' }, { id: 'l2', kind: 'lane', title: 'B' },
    { id: 'a', kind: 'item', lane: 'l1', parent: 'b' }, { id: 'b', kind: 'item', lane: 'l1', parent: 'a' },
    { id: 'c', kind: 'item', lane: 'l2', parent: 'a' }, { id: 'd', kind: 'item', lane: 'l1', parent: 'zz' }
  ] };
  const doc = fromEnvelope(env);
  const p = Object.fromEntries(doc.items.map(i => [i.id, i.parent]));
  assert.ok(p.a === null || p.b === null, 'a loop is broken');
  assert.equal(p.c, null); assert.equal(p.d, null);
  const n = load();
  removeItem(n, by(n, 'Feature a').id);
  assert.equal(by(n, 'Story x').parent, by(n, 'Epic one').id);
});

test('setLane takes the children along and leaves the parent; setParent refuses loops and depth', () => {
  const doc = load('## A\n- Epic\n  - Feat\n    - Story\n## B\n- Other\n');
  const B = doc.lanes.find(l => l.title === 'B').id;
  setLane(doc, by(doc, 'Feat').id, B);
  assert.equal(by(doc, 'Feat').parent, null);
  assert.equal(by(doc, 'Story').lane, B);
  assert.equal(by(doc, 'Story').parent, by(doc, 'Feat').id);
  assert.equal(setParent(doc, by(doc, 'Feat').id, by(doc, 'Story').id), false, 'not under its own child');
  assert.equal(setParent(doc, by(doc, 'Feat').id, by(doc, 'Other').id), true);
  assert.ok(!parentChoices(doc, by(doc, 'Other').id).some(x => x.id === by(doc, 'Story').id));
});

test('timeline: an epic gets its own rows, one level per row group, colored by level', () => {
  const doc = load();
  const L = layout(doc, { range: { from: '2027-01-01', to: '2027-03-31' } });
  const bar = t => L.bars.find(b => b.item.title === t);
  assert.equal(bar('Loose').row, 0);
  assert.ok(bar('Epic one').row < bar('Feature a').row && bar('Feature a').row < bar('Story x').row);
  assert.ok(bar('Feature b').row < bar('Story x').row, 'every feature row comes before the story rows');
  assert.deepEqual(['Epic one', 'Feature a', 'Story x'].map(t => bar(t).color), ['purple', 'teal', 'slate']);
  by(doc, 'Feature a').color = 'red';
  assert.equal(layout(doc, { range: { from: '2027-01-01', to: '2027-03-31' } }).bars.find(b => b.item.title === 'Feature a').color, 'red');
});

test('ADO: a Feature sits under its Epic in the same lane, and type sets the level', () => {
  const result = { items: [
    { id: 1, type: 'Epic', title: 'E', area: 'P\\T', state: 'New' },
    { id: 2, type: 'Feature', title: 'F', area: 'P\\T', parentId: 1, state: 'New' },
    { id: 3, type: 'Feature', title: 'G', area: 'P\\T', state: 'New' }
  ] };
  const src = { types: ['Epic', 'Feature'], lanes: 'area', areas: ['P\\T'], connection: 'c' };
  const doc = applyLive(blankDoc(), pulled(result, null, src), src, result);
  assert.equal(by(doc, 'F').parent, by(doc, 'E').id);
  const lv = levels(fromEnvelope({ meta: doc.meta, items: toEnvelopeParts(doc).items }));
  assert.equal(lv.get(by(doc, 'G').id), 1, 'a Feature with no Epic is still feature level');
});
