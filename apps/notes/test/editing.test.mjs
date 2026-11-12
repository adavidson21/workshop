// Folio: editing helpers. The slash menu (js/slash.js), Format table (js/tables.js), and bold, italic, code
// and link (js/edits.js toggleWrap, makeLink).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLASH, applySlash, slashAt, slashItems } from '../js/slash.js';
import { formatTable, tableAt } from '../js/tables.js';
import { makeLink, toggleWrap } from '../js/edits.js';
import { KITS } from '../js/diagram-kits.js';

const apply = (text, r) => text.slice(0, r.from) + r.insert + text.slice(r.to);

test('slashAt: / at the start of a line, after spaces only, and never inside code', () => {
  assert.deepEqual(slashAt('Hello\n/ta', 9), { start: 6, query: 'ta' });
  assert.deepEqual(slashAt('  /', 3), { start: 2, query: '' });
  assert.equal(slashAt('a /ta', 5), null, 'not mid-line');
  assert.equal(slashAt('see /usr/bin', 12), null);
  assert.equal(slashAt('```\n/usr', 8), null, 'not in an unclosed fence');
  assert.equal(slashAt('```sh\n/usr\n```', 10), null, 'not in a closed fence');
  assert.deepEqual(slashAt('```sh\nx\n```\n/co', 15), { start: 12, query: 'co' }, 'after a fence is fine');
});

test('slashItems: every entry reachable, ids first, then words; diagrams and callouts included', () => {
  const ids = new Set(SLASH.map(x => x.id));
  assert.equal(ids.size, SLASH.length, 'ids are unique');
  for (const k of KITS) assert.ok(ids.has(k.id), k.id);
  for (const k of ['note', 'tip', 'important', 'warning', 'caution', 'table', 'code', 'task', 'h2', 'date']) assert.ok(ids.has(k), k);
  assert.equal(slashItems('ta')[0].id, 'table');
  assert.equal(slashItems('seq')[0].id, 'sequence');
  assert.ok(slashItems('mermaid').length >= KITS.length || slashItems('mermaid', 50).length >= KITS.length);
  assert.ok(slashItems('diagram', 50).every(x => KITS.some(k => k.id === x.id)));
  assert.deepEqual(slashItems('zzzz'), []);
  assert.equal(slashItems('').length, 10);
});

test('applySlash: a line prefix replaces /word; a block goes on lines of its own with the cursor placed', () => {
  const h2 = SLASH.find(x => x.id === 'h2');
  let t = 'Intro\n/h2', r = applySlash(t, 6, 9, h2);
  assert.equal(apply(t, r), 'Intro\n## ');
  assert.equal(r.cursor, 9);
  const table = SLASH.find(x => x.id === 'table');
  t = 'Intro\n/tab\nNext'; r = applySlash(t, 6, 10, table);
  const out = apply(t, r);
  assert.equal(out, 'Intro\n\n| Column | Column |\n| --- | --- |\n|  |  |\n\nNext');
  assert.equal(out.slice(r.cursor, r.cursor + 6), 'Column');
  const code = SLASH.find(x => x.id === 'code');
  t = '/code'; r = applySlash(t, 0, 5, code);
  assert.equal(apply(t, r), '```\n\n```\n');
  assert.equal(r.cursor, 3, 'after ``` to type the language');
  const warn = SLASH.find(x => x.id === 'warning');
  t = 'A\n\n/warn'; r = applySlash(t, 3, 8, warn);
  const w = apply(t, r);
  assert.equal(w, 'A\n\n> [!WARNING]\n> \n');
  assert.equal(r.cursor, w.indexOf('> \n') + 2, 'the cursor on the callout body');
  const flow = SLASH.find(x => x.id === 'flowchart');
  t = '/flow'; r = applySlash(t, 0, 5, flow);
  assert.ok(apply(t, r).startsWith('```mermaid\nflowchart LR\n'));
  assert.equal(apply(t, r).slice(r.cursor).split('\n')[0], 'flowchart LR');
  const date = SLASH.find(x => x.id === 'date');
  t = 'On /date'; r = applySlash('/date', 0, 5, date, { day: '2026-11-07' });
  assert.equal(apply('/date', r), '2026-11-07');
});

test('formatTable lines up columns, keeps alignment, pads short rows, and leaves other text alone', () => {
  const t = 'x\n|a|bb|c|\n|:-|-:|:-:|\n|long cell|2|x|\n|short|\n\ny';
  assert.deepEqual(tableAt(t, 3), { from: 1, to: 4 });
  assert.equal(tableAt(t, 0), null);
  assert.equal(tableAt('a | b\nno separator', 0), null);
  assert.equal(formatTable(t, 2), 'x\n| a         |  bb |  c  |\n| :-------- | --: | :-: |\n| long cell |   2 |  x  |\n| short     |     |     |\n\ny');
  assert.equal(formatTable(formatTable(t, 2), 2), formatTable(t, 2), 'formatting twice changes nothing');
  assert.equal(formatTable(t, 0), null);
  assert.ok(formatTable('| a \\| b | c |\n|---|---|\n| 1 | 2 |', 0).startsWith('| a \\| b | c   |'), 'escaped pipes stay in their cell');
});

test('toggleWrap adds and takes off markers; with no selection it wraps the word at the cursor', () => {
  const t = 'make this bold';
  let r = toggleWrap(t, 5, 9, '**');
  assert.equal(apply(t, r), 'make **this** bold');
  assert.equal(apply(t, r).slice(r.selFrom, r.selTo), 'this');
  const t2 = apply(t, r);
  r = toggleWrap(t2, r.selFrom, r.selTo, '**');
  assert.equal(apply(t2, r), t, 'toggled off');
  r = toggleWrap(t, 7, 7, '*');
  assert.equal(apply(t, r), 'make *this* bold', 'the word at the cursor');
  r = toggleWrap('a  b', 2, 2, '`');
  assert.equal(apply('a  b', r), 'a `` b');
  assert.equal(r.selFrom, 3);
  r = toggleWrap('x **y** z', 2, 7, '**');
  assert.equal(apply('x **y** z', r), 'x y z', 'a selection that includes the markers');
});

test('makeLink wraps the selection and selects the url; a selected URL becomes the target', () => {
  let r = makeLink('see docs here', 4, 8);
  assert.equal(apply('see docs here', r), 'see [docs](url) here');
  assert.equal(apply('see docs here', r).slice(r.selFrom, r.selTo), 'url');
  r = makeLink('go https://x.io now', 3, 15);
  assert.equal(apply('go https://x.io now', r), 'go [](https://x.io) now');
  assert.equal(r.selFrom, 4);
});
