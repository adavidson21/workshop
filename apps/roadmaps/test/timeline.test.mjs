// The timeline: placement, rows, dependency warnings, and an SVG that escapes text and shows what it should.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, reconcile } from '../js/outline.js';
import { blankDoc, depWarnings, moveItem, resizeItem, schedule, viewRange } from '../js/model.js';
import { GUTTER, dateAt, laneAt, layout, svg } from '../js/timeline.js';
import { exportSvg } from '../js/export.js';

const docOf = (text) => reconcile(blankDoc('x', new Date('2026-11-03T12:00:00')), parse(text, { today: '2026-11-03' })).doc;
const DOC = `# Plan
scale: month
start: 2027-01-01

## Search
- Index | Jan-Feb 2027
- Ranking | Feb-Mar 2027 | after: Index
- * Live | 2027-04-15

## Alerts
- Rework | Jan 2027
`;

test('overlapping items in a lane go on separate rows; the next lane starts below', () => {
  const doc = docOf(DOC);
  const L = layout(doc, { range: { from: '2026-12-01', to: '2027-05-31' } });
  const idx = L.bars.find(b => b.item.title === 'Index'), rank = L.bars.find(b => b.item.title === 'Ranking');
  assert.notEqual(idx.row, rank.row);
  assert.equal(L.lanes.length, 2);
  assert.equal(L.lanes[1].y, L.lanes[0].y + L.lanes[0].h);
  assert.equal(laneAt(L, L.lanes[1].y + 2).title, 'Alerts');
  assert.equal(idx.x, Math.round(L.x('2027-01-01') * 10) / 10);
  assert.equal(dateAt(L, L.x('2027-02-10')), '2027-02-10');
  assert.ok(idx.x >= GUTTER);
});

test('an item that starts before what it depends on ends is a warning, drawn dashed', () => {
  const doc = docOf(DOC);
  const warns = depWarnings(doc);
  assert.equal(warns.length, 1);
  const text = svg(layout(doc, { range: viewRange(doc) }), {});
  assert.match(text, /stroke-dasharray="4 3"/);
  assert.match(text, />! Ranking</);
});

test('moving keeps the length; resizing never crosses the other edge', () => {
  const doc = docOf(DOC);
  const id = doc.items.find(i => i.title === 'Index').id;
  moveItem(doc, id, '2027-03-01');
  assert.deepEqual(schedule(doc).get(id), { start: '2027-03-01', end: '2027-04-28' });
  resizeItem(doc, id, '2027-02-01', 'end');
  assert.deepEqual(schedule(doc).get(id), { start: '2027-03-01', end: '2027-03-01' });
  const live = doc.items.find(i => i.title === 'Live');
  moveItem(doc, live.id, '2027-05-01');
  assert.deepEqual([live.start, live.end], ['2027-05-01', '2027-05-01']);
});

test('the SVG escapes every piece of text', () => {
  const doc = docOf('# <img src=x onerror=alert(1)>\n## <script>alert(1)</script>\n- <b>bold</b> & "q" | Jan 2027\n');
  doc.items[0].notes = '<script>';
  const text = exportSvg(doc, { range: { from: '2027-01-01', to: '2027-03-31' } });
  assert.ok(!/<script|<img|<b>/i.test(text));
  assert.match(text, />&lt;script&gt;alert\(1\)/);
  assert.match(text, /&lt;b&gt;bold&lt;\/b&gt; &amp; &quot;q&quot;/);
});

test('an image export shows every visible item, leaves folded lanes out, and can hide the title and today line', () => {
  const doc = docOf(DOC);
  const r = { from: '2026-12-01', to: '2027-05-31' };
  const full = exportSvg(doc, { range: r, now: new Date('2027-02-01T12:00:00') });
  for (const t of ['Index', 'Ranking', 'Live', 'Rework', 'Search', 'Alerts', 'Plan']) assert.ok(full.includes(`>${t}<`) || full.includes(`>! ${t}<`), t);
  assert.match(full, />Today</);
  doc.meta.hidden = [doc.lanes.find(l => l.title === 'Alerts').id];
  const folded = exportSvg(doc, { range: r, title: false, todayLine: false, now: new Date('2027-02-01T12:00:00') });
  assert.ok(!folded.includes('>Rework<') && !folded.includes('>Alerts<'));
  assert.ok(!folded.includes('>Plan<'));
  assert.ok(!folded.includes('>Today<'));
  assert.match(folded, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="\d+" height="\d+"/);
});

test('dark theme uses the dark colors', () => {
  const doc = docOf(DOC);
  assert.match(exportSvg(doc, { theme: 'dark' }), /fill="#141012"/);
  assert.match(exportSvg(doc, { theme: 'light' }), /fill="#F4F2F3"/);
});

test('the shown range fits the items with a period either side, or the map range when set', () => {
  const doc = docOf(DOC);
  assert.deepEqual(viewRange(doc), { from: '2026-12-01', to: '2027-05-31' });
  doc.meta.range = { from: '2027-01-01', to: '2027-02-28' };
  assert.deepEqual(viewRange(doc), { from: '2027-01-01', to: '2027-02-28' });
  const L = layout(doc, { range: viewRange(doc) });
  assert.ok(!L.bars.some(b => b.item.title === 'Live'));
  assert.ok(L.bars.find(b => b.item.title === 'Ranking').clipR);
});
