import test from 'node:test';
import assert from 'node:assert/strict';
import { blankDoc, cleanItem, placeBeside, schedule } from '../js/model.js';
import { parse, reconcile, serialize } from '../js/outline.js';
import { barAt, layout, rowAt } from '../js/timeline.js';

const OUT = `# T
scale: month
start: 2027-01-01

## Lane A
- Epic one | Jan-Mar 2027
  - Feature a | Jan 2027
    - Story x | 2027-01-05..2027-01-09
    - Story y | 2027-01-20..2027-01-24
  - Feature b | Feb 2027
- Loose | Mar 2027

## Lane B
- Other | 2027-02-01..2027-02-10
`;
const load = () => reconcile(blankDoc(), parse(OUT, { today: '2027-01-01' })).doc;
const by = (doc, t) => doc.items.find(i => i.title === t);
const range = { from: '2026-12-01', to: '2027-04-30' };

test('placeBeside: after a story starts the next day, keeps its length, joins its feature, goes next to it in the outline', () => {
  const doc = load();
  const other = by(doc, 'Other');
  assert.ok(placeBeside(doc, other.id, by(doc, 'Story x').id, 'after'));
  assert.deepEqual([other.start, other.end], ['2027-01-10', '2027-01-19']);
  assert.equal(other.lane, by(doc, 'Story x').lane);
  assert.equal(other.parent, by(doc, 'Feature a').id);
  assert.match(serialize(doc), /- Story x \| [^\n]+\n {4}- Other \| [^\n]+\n {4}- Story y/);
  // nothing else moved
  assert.deepEqual([by(doc, 'Story y').start, by(doc, 'Story y').end], ['2027-01-20', '2027-01-24']);
});

test('placeBeside: before a story ends the day before it starts; an unscheduled item takes one period', () => {
  const doc = load();
  doc.items.push(cleanItem({ id: 'n1', kind: 'item', lane: null, order: 9, title: 'New', size: { n: 3, unit: 'day' } }));
  doc.items.push(cleanItem({ id: 'n2', kind: 'item', lane: null, order: 10, title: 'Bare' }));
  assert.ok(placeBeside(doc, 'n1', by(doc, 'Story y').id, 'before'));
  assert.deepEqual([by(doc, 'New').start, by(doc, 'New').end, by(doc, 'New').size], ['2027-01-17', '2027-01-19', null]);
  assert.ok(placeBeside(doc, 'n2', by(doc, 'Loose').id, 'after'));
  const bare = by(doc, 'Bare');
  assert.deepEqual([bare.start, bare.end, bare.parent], ['2027-04-01', '2027-04-30', null]);
});

test('placeBeside: refuses itself and its own children; a parent too deep to hold it leaves it top level', () => {
  const doc = load();
  const epic = by(doc, 'Epic one');
  assert.equal(placeBeside(doc, epic.id, by(doc, 'Story x').id, 'after'), false);
  assert.equal(placeBeside(doc, epic.id, epic.id, 'after'), false);
  // An item with two levels under it can't sit under a feature (that would be 5 levels).
  const deep = load();
  assert.ok(placeBeside(deep, by(deep, 'Epic one').id, by(deep, 'Other').id, 'after'));
  assert.equal(by(deep, 'Epic one').parent, null);
  assert.equal(by(deep, 'Story x').lane, by(deep, 'Other').lane);
});

test('barAt and rowAt: which half of a bar, and the parent of the nearest bar in a row', () => {
  const doc = load();
  const L = layout(doc, { sched: schedule(doc), range });
  const x = L.bars.find(b => b.item.title === 'Story x');
  const y = x.y + x.h / 2;
  assert.equal(barAt(L, x.x + 1, y).side, 'before');
  assert.equal(barAt(L, x.x + x.w - 1, y).side, 'after');
  assert.equal(barAt(L, x.x + 1, y, new Set([x.id])), null);
  const sy = L.bars.find(b => b.item.title === 'Story y');
  const r = rowAt(L, L.x('2027-03-15'), sy.y + 2);
  assert.equal(r.parent, by(doc, 'Feature a').id);
  assert.equal(r.near.item.title, 'Story y');
  const loose = L.bars.find(b => b.item.title === 'Loose');
  assert.equal(rowAt(L, loose.x, loose.y + 2).parent, null);
  assert.equal(rowAt(L, 10, L.height + 50), undefined);
});
