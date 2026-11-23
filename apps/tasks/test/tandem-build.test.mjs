// Build with Tandem on any task (js/tandem-build.js, Tasks 12.4.0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPath, buildText, canBuild } from '../js/tandem-build.js';

const t = { id: 't_1', title: 'Add CSV export to reports', firstStep: 'Find the report page', notes: 'Finance asked for it.\nComma separated.', done: false };
const on = { embedded: true, buildsOn: true, adoItem: false };

test('buildText: title, first step, notes, then a link back to the task', () => {
  assert.equal(buildText(t), 'Add CSV export to reports\n\nFirst step: Find the report page\n\nFinance asked for it.\nComma separated.\n\nFrom Tasks: [Add CSV export to reports](ws:tasks/task/t_1)');
  assert.equal(buildText({ id: 't_2', title: 'Just a title' }), 'Just a title\n\nFrom Tasks: [Just a title](ws:tasks/task/t_2)');
  assert.equal(buildText({ id: 't_3', title: '  ' }), '');
  assert.equal(buildText(null), '');
  assert.ok(buildText({ id: 'x', title: 'a', notes: 'n'.repeat(20000) }).length <= 8000);
});

test('buildPath: Builds\' start/go route with the text encoded as one segment', () => {
  const p = buildPath(t);
  assert.match(p, /^start\/go\/[^/]+$/);
  assert.equal(decodeURIComponent(p.slice('start/go/'.length)), buildText(t));
});

test('canBuild: open tasks inside Workshop with Builds on, not ADO items with their own Start', () => {
  assert.equal(canBuild(t, on), true);
  assert.equal(canBuild({ ...t, done: true }, on), false);
  assert.equal(canBuild(t, { ...on, embedded: false }), false, "Tasks' own site has no Builds");
  assert.equal(canBuild(t, { ...on, buildsOn: false }), false);
  assert.equal(canBuild(t, { ...on, adoItem: true }), false);
  assert.equal(canBuild({ ...t, title: '' }, on), false);
});
