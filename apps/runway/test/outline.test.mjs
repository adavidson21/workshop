// The outline: lanes, ranges, sizes, milestones, after:, bad lines kept with a warning, and the round trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TABLE_MARK, formatWhen, parse, parseWhen, reconcile, serialize } from '../js/outline.js';
import { blankDoc, schedule } from '../js/model.js';

const TODAY = '2026-11-03';
const ctx = { origin: '2027-01-04', sprint: { anchor: '2027-01-06', weeks: 2 }, year: 2027 };
const SAMPLE = `# Platform Q1 2027
scale: sprint
start: 2027-01-04
sprint: 2027-01-06, 2 weeks

## Search
- Content migration | S1-S3
- Search cutover | S4 | after: Content migration
- * Launch | S5
  Tell the team. https://example.com/launch

## Alerts
- Alerting rework | 3 sprints | after: Search cutover | status: at risk | color: amber
- Later idea
`;
const docOf = (text, base = blankDoc('x', new Date('2026-11-03T12:00:00'))) => reconcile(base, parse(text, { today: TODAY, defaults: base.meta }));

test('reads dates in many forms', () => {
  assert.deepEqual(parseWhen('Jan-Mar 2027', ctx), { start: '2027-01-01', end: '2027-03-31' });
  assert.deepEqual(parseWhen('jan - mar', ctx), { start: '2027-01-01', end: '2027-03-31' });
  assert.deepEqual(parseWhen('Nov..Feb', ctx), { start: '2027-11-01', end: '2028-02-29' });
  assert.deepEqual(parseWhen('Nov 2026..Feb', ctx), { start: '2026-11-01', end: '2027-02-28' });
  assert.deepEqual(parseWhen('Q2', ctx), { start: '2027-04-01', end: '2027-06-30' });
  assert.deepEqual(parseWhen('Q4 2026..Q1 2027', ctx), { start: '2026-10-01', end: '2027-03-31' });
  assert.deepEqual(parseWhen('2027 Q3', ctx), { start: '2027-07-01', end: '2027-09-30' });
  assert.deepEqual(parseWhen('2027-02', ctx), { start: '2027-02-01', end: '2027-02-28' });
  assert.deepEqual(parseWhen('2027-03-01..2027-03-15', ctx), { start: '2027-03-01', end: '2027-03-15' });
  assert.deepEqual(parseWhen('2027-03-01 to 2027-03-15', ctx), { start: '2027-03-01', end: '2027-03-15' });
  assert.deepEqual(parseWhen('S1-S3', ctx), { start: '2027-01-06', end: '2027-02-16' });
  assert.deepEqual(parseWhen('s2', ctx), { start: '2027-01-20', end: '2027-02-02' });
  assert.deepEqual(parseWhen('W1-W2', ctx), { start: '2027-01-04', end: '2027-01-17' });
  assert.deepEqual(parseWhen('3 sprints', ctx), { size: { n: 3, unit: 'sprint' } });
  assert.deepEqual(parseWhen('2w', ctx), { size: { n: 2, unit: 'week' } });
  assert.equal(parseWhen('2027-03-15..2027-03-01', ctx), null);
  assert.equal(parseWhen('soon', ctx), null);
  assert.equal(parseWhen('S0', ctx), null);
});

test('reads lanes, items, milestones, after, status, color and notes', () => {
  const p = parse(SAMPLE, { today: TODAY });
  assert.deepEqual(p.meta, { scale: 'sprint', origin: '2027-01-04', sprint: { anchor: '2027-01-06', weeks: 2 }, title: 'Platform Q1 2027' });
  assert.deepEqual(p.lanes.map(l => l.title), ['Search', 'Alerts']);
  assert.equal(p.warnings.length, 0);
  const [a, b, m, c, d] = p.entries;
  assert.deepEqual([a.lane, a.start, a.end], [0, '2027-01-06', '2027-02-16']);
  assert.deepEqual(b.after, ['Content migration']);
  assert.ok(m.milestone && m.start === '2027-03-03' && m.end === m.start);
  assert.equal(m.notes, 'Tell the team. https://example.com/launch');
  assert.deepEqual([c.size, c.status, c.color, c.lane], [{ n: 3, unit: 'sprint' }, 'at risk', 'amber', 1]);
  assert.ok(!d.start && !d.size);
});

test('a line it cannot read stays as text with a warning; nothing is dropped', () => {
  const text = '## A\n- Fine | Jan 2027\n- Broken | someday\nloose words\n### Sub\n- Bad status | Q1 | status: maybe\n';
  const { doc, warnings } = docOf(text);
  assert.equal(warnings.length, 4);
  assert.deepEqual(doc.items.filter(i => i.kind === 'text').map(i => i.raw), ['- Broken | someday', 'loose words', '### Sub', '- Bad status | Q1 | status: maybe']);
  assert.equal(serialize(doc).split('\n').slice(3).join('\n'), '\n## A\n- Fine | Jan 2027\n- Broken | someday\nloose words\n### Sub\n- Bad status | Q1 | status: maybe\n');
});

test('round trip: outline to roadmap to outline gives the same text and the same ids', () => {
  const { doc } = docOf(SAMPLE);
  const once = serialize(doc);
  const again = docOf(once, doc);
  assert.equal(serialize(again.doc), once);
  assert.deepEqual(again.doc.items.map(i => i.id), doc.items.map(i => i.id));
  assert.deepEqual(again.doc.lanes.map(l => l.id), doc.lanes.map(l => l.id));
  assert.match(once, /- Content migration \| S1-S3\n/);
  assert.match(once, /- Alerting rework \| 3 sprints \| after: Search cutover \| status: at risk \| color: amber/);
});

test('after: links items by title, and a missing one is kept and warned about', () => {
  const { doc, warnings } = docOf('## A\n- One | Jan 2027\n- Two | 1 month | after: One, Ghost\n');
  const one = doc.items.find(i => i.title === 'One'), two = doc.items.find(i => i.title === 'Two');
  assert.deepEqual(two.dependsOn, [one.id]);
  assert.deepEqual(two.afterMissing, ['Ghost']);
  assert.equal(warnings.length, 1);
  assert.match(serialize(doc), /- Two \| 1 month \| after: One, Ghost/);
  // A size starts the day after what it depends on ends.
  assert.deepEqual(schedule(doc).get(two.id), { start: '2027-02-01', end: '2027-02-28' });
});

test('editing a title in the outline keeps other items and their colors', () => {
  const { doc } = docOf('## A\n- One | Jan 2027\n- Two | Feb 2027 | color: teal\n');
  doc.items[1].ado = { id: 42, connection: 'main', rev: 3 };
  const r = docOf(serialize(doc).replace('- One |', '- One renamed |'), doc);
  assert.deepEqual(r.doc.items[1].ado, { id: 42, connection: 'main', rev: 3 });
  assert.equal(r.doc.items[1].id, doc.items[1].id);
  assert.equal(r.doc.items[1].color, 'teal');
  assert.notEqual(r.doc.items[0].id, doc.items[0].id);
});

test('a pipe in a title survives', () => {
  const { doc } = docOf('- A \\| B | 2027-01-04\n');
  assert.equal(doc.items[0].title, 'A | B');
  assert.match(serialize(doc), /- A \\\| B \| 2027-01-04\.\.2027-01-04|- A \\\| B \| 2027-01-04/);
});

test('the export table after the marker is ignored on import', () => {
  const p = parse(`## A\n- One | Jan 2027\n${TABLE_MARK}\n\n| Lane | Item |\n| --- | --- |\n| A | One |\n`, { today: TODAY });
  assert.equal(p.entries.length, 1);
  assert.equal(p.warnings.length, 0);
});

test('dates are written in the map scale', () => {
  const m = { scale: 'month', origin: '2027-01-01' };
  assert.equal(formatWhen('2027-01-01', '2027-03-31', m), 'Jan-Mar 2027');
  assert.equal(formatWhen('2026-11-01', '2027-02-28', m), 'Nov 2026..Feb 2027');
  assert.equal(formatWhen('2027-01-01', '2027-03-31', { ...m, scale: 'quarter' }), 'Q1 2027');
  assert.equal(formatWhen('2027-01-01', '2027-06-30', { ...m, scale: 'quarter' }), 'Q1-Q2 2027');
  assert.equal(formatWhen('2027-01-05', '2027-01-20', m), '2027-01-05..2027-01-20');
  assert.equal(formatWhen('2027-01-04', '2027-01-17', { scale: 'week', origin: '2027-01-04' }), 'W1-W2');
});

test('bad header lines warn and stay', () => {
  const p = parse('scale: fortnight\nstart: someday\n## A\n', { today: TODAY });
  assert.equal(p.warnings.length, 2);
  assert.equal(p.meta.scale, undefined);
});
