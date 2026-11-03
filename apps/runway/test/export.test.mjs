// Markdown export: the outline, an optional table that import ignores, file names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdown, fileName } from '../js/export.js';
import { parse, reconcile, serialize } from '../js/outline.js';
import { blankDoc } from '../js/model.js';
import { exampleOutline } from '../js/example.js';

const docOf = (text) => reconcile(blankDoc('x', new Date('2026-11-03T12:00:00')), parse(text, { today: '2026-11-03' })).doc;

test('Markdown is the outline; with a table, the table imports as nothing', () => {
  const doc = docOf('# Plan\nscale: month\nstart: 2027-01-01\n\n## A\n- One | Jan 2027\n- Two | 1 month | after: One | status: active\n- * Ship | 2027-03-10\n');
  assert.equal(markdown(doc), serialize(doc));
  const md = markdown(doc, { table: true });
  assert.match(md, /\| Lane \| Item \| Start \| End \| Status \| After \|/);
  assert.match(md, /\| A \| Two \| Feb 1, 2027 \| Feb 28, 2027 \| active \| One \|/);
  assert.match(md, /\| A \| Milestone: Ship \| Mar 10, 2027 \|  \|/);
  const back = docOf(md);
  assert.equal(serialize(back), serialize(doc));
});

test('file names are safe for every system', () => {
  assert.equal(fileName('Platform Q1 2027: plan/draft', 'png', new Date('2026-11-03T12:00:00')), 'platform-q1-2027-plan-draft-2026-11-03.png');
  assert.equal(fileName('', 'md', new Date('2026-11-03T12:00:00')), 'roadmap-2026-11-03.md');
  assert.match(fileName('Ünïcode ✨', 'svg'), /^unicode-\d{4}-\d{2}-\d{2}\.svg$/);
});

test('the example roadmap parses cleanly and uses no real names', () => {
  const p = parse(exampleOutline(new Date('2026-11-03T12:00:00')), { today: '2026-11-03' });
  assert.deepEqual(p.warnings, []);
  assert.equal(p.lanes.length, 3);
});
