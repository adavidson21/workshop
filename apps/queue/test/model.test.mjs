// Queue rules: views, filters, sorting, team rows, stale math, changes and the untrusted-HTML sanitizer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageDays, changedSinceSeen, cleanSettings, describeChange, diffItems, facets, isStale, meOf, teamRows, viewCounts, visible } from '../js/model.js';
import { safeHref, sanitize } from '../js/sanitize.js';
import { confirmHtml, detail, identity, parsePeople, render, rowHtml, safeUrl } from '../js/view.js';
import { DEV1, ME, item } from './fake.mjs';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const items = [
  item(1, { assignee: ME, priority: 1, tags: ['api'], changed: '2026-10-14T00:00:00Z' }),
  item(2, { assignee: DEV1, state: 'New', changed: '2026-10-01T00:00:00Z', iteration: 'Web App\\Sprint 11' }),
  item(3, { assignee: null, type: 'User Story', priority: 3, changed: '2026-10-13T00:00:00Z' }),
  item(4, { assignee: { name: 'Outsider', email: 'outsider@example.com' }, area: 'Web App\\Team A\\Sub', changed: '2026-10-12T00:00:00Z' })
];
const ctx = { me: { name: ME.name, email: ME.email }, people: [ME, DEV1], currentIterations: ['Web App\\Sprint 12'] };

test('built-in views', () => {
  const ids = viewId => visible(items, { viewId, filters: {}, ctx, staleDays: 7, now: NOW }).map(i => i.id);
  assert.deepEqual(ids('mine'), [1]);
  assert.deepEqual(ids('team'), [1, 2], 'team = assigned to the people list');
  assert.deepEqual(ids('unassigned'), [3]);
  assert.deepEqual(ids('sprint'), [1, 3, 4]);
  assert.deepEqual(ids('all'), [1, 3, 4, 2], 'sorted by last change');
  assert.deepEqual(viewCounts(items, ctx), { mine: 1, team: 2, unassigned: 1, sprint: 3, all: 4 });
  assert.deepEqual(visible(items, { viewId: 'team', filters: {}, ctx: { ...ctx, people: [] }, staleDays: 7, now: NOW }).map(i => i.id), [1, 4, 2], 'no people: anything assigned');
});

test('filters, search and sort', () => {
  const ids = (filters, sort) => visible(items, { viewId: 'all', filters, sort, ctx, staleDays: 7, now: NOW }).map(i => i.id);
  assert.deepEqual(ids({ type: 'User Story' }), [3]);
  assert.deepEqual(ids({ state: 'New' }), [2]);
  assert.deepEqual(ids({ assignee: 'dev.one@example.com' }), [2]);
  assert.deepEqual(ids({ assignee: '-' }), [3]);
  assert.deepEqual(ids({ priority: '1' }), [1]);
  assert.deepEqual(ids({ tag: 'API' }), [1]);
  assert.deepEqual(ids({ area: 'Web App\\Team A' }), [1, 3, 4, 2], 'area includes sub-areas');
  assert.deepEqual(ids({ area: 'Web App\\Team A\\Sub' }), [4]);
  assert.deepEqual(ids({ stale: true }), [2]);
  assert.deepEqual(ids({ q: '#3' }), [3]);
  assert.deepEqual(ids({ q: 'synthetic item 2' }), [2]);
  assert.deepEqual(ids({}, 'priority'), [1, 4, 2, 3]);
  assert.deepEqual(ids({}, 'id'), [4, 3, 2, 1]);
});

test('stale math, team rows, facets and changed since seen', () => {
  assert.equal(ageDays('2026-10-08T12:00:00Z', NOW), 7);
  assert.equal(isStale(items[1], 7, NOW), true);
  assert.equal(isStale(items[0], 7, NOW), false);
  assert.equal(ageDays('', NOW), null);
  const rows = teamRows(items, { people: [ME, DEV1, { name: 'Idle', email: 'idle@example.com' }], categories: { Bug: { Active: 'InProgress', New: 'Proposed' } }, staleDays: 7, now: NOW });
  assert.deepEqual(rows.map(r => [r.name, r.open, r.inProgress, r.stale]), [['Dev One', 1, 0, 1], ['Engineer A', 1, 1, 0], ['Idle', 0, 0, 0]]);
  const f = facets(items);
  assert.deepEqual(f.types, ['Bug', 'User Story']);
  assert.deepEqual(f.tags, ['api']);
  assert.deepEqual(f.assignees.map(a => a.name), ['Dev One', 'Engineer A', 'Outsider']);
  assert.deepEqual([...changedSinceSeen(items, { 1: 3, 2: 1 })], [2], 'unseen items are not marked');
});

test('settings are cleaned; me comes from settings, else ADO', () => {
  const s = cleanSettings({ areas: ['a', 'a', ' ', 'b'], people: [{ name: 'X', email: 'X@Example.com' }, { name: 'X', email: 'x@example.com' }, {}], refreshMinutes: 2, staleDays: 7.5, meEmail: 'ME@x.com' });
  assert.deepEqual(s.areas, ['a', 'b']);
  assert.deepEqual(s.people, [{ name: 'X', email: 'x@example.com' }]);
  assert.equal(s.refreshMinutes, 15);
  assert.equal(s.staleDays, 7);
  assert.deepEqual(meOf(s, ME), { name: '', email: 'me@x.com' });
  assert.deepEqual(meOf(cleanSettings({}), ME), ME);
  assert.equal(meOf(cleanSettings({}), null), null);
  assert.deepEqual(parsePeople('Dev One <Dev.One@example.com>\nsolo@example.com\nJust A Name\n'), [
    { name: 'Dev One', email: 'dev.one@example.com' }, { name: 'solo@example.com', email: 'solo@example.com' }, { name: 'Just A Name', email: '' }
  ]);
  assert.equal(identity(DEV1), 'Dev One <dev.one@example.com>');
  assert.equal(identity({ name: '', email: 'a@b.c' }), 'a@b.c');
});

test('changes in plain words for the confirm step and the conflict message', () => {
  const it = items[0];
  assert.deepEqual(describeChange(it, { state: 'Closed', assignedTo: '', priority: 3, iteration: 'Web App\\Sprint 13', tagsAdd: ['ui'], tagsRemove: ['api'] }), [
    'State: Active to Closed', 'Assigned to: Engineer A to nobody', 'Priority: 1 to 3', 'Sprint: Sprint 12 to Sprint 13', 'Add tag: ui', 'Remove tag: api'
  ]);
  assert.deepEqual(diffItems(it, { ...it, state: 'Resolved', assignee: DEV1 }), ['State: Active to Resolved', 'Assigned to: Engineer A to Dev One']);
});

test('sanitizer keeps an allowlist and drops everything dangerous', () => {
  assert.equal(sanitize('<p>Steps <b>one</b></p><script>alert(1)</script>'), '<p>Steps <b>one</b></p>');
  assert.equal(sanitize('<img src=x onerror=alert(1)>'), '<span class="img-note">[image: open in ADO to see it]</span>');
  assert.equal(sanitize('<a href="javascript:alert(1)">x</a>'), '<span>x</span>');
  assert.equal(sanitize('<a href="jav&#x61;script:alert(1)">x</a>'), '<span>x</span>');
  assert.equal(sanitize('<a href=" JAVASCRIPT:alert(1)">x</a>'), '<span>x</span>');
  assert.equal(sanitize('<a href="https://ok.example/a?b=1&amp;c=2" onclick="x()">ok</a>'), '<a href="https://ok.example/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">ok</a>');
  assert.equal(sanitize('<iframe src="https://evil.example">inside</iframe>after'), 'after');
  assert.equal(sanitize('<style>body{display:none}</style><p style="color:red" class="x">t</p>'), '<p>t</p>');
  assert.equal(sanitize('<svg><script>x</script><a href="https://e.example">l</a></svg>y'), 'y');
  assert.equal(sanitize('<p onmouseover="x">a &lt;script&gt; b</p>'), '<p>a &lt;script&gt; b</p>');
  assert.equal(sanitize('<div>one<div>two</div></div>'), '<p>one</p><p>two</p>');
  assert.equal(sanitize('<ul><li>1<li>2</ul>'), '<ul><li>1</li><li>2</li></ul>');
  assert.equal(sanitize('<b>unclosed'), '<b>unclosed</b>');
  assert.equal(sanitize('<p>a</b></i>b</p>'), '<p>ab</p>');
  assert.equal(sanitize('<!-- <script>x</script> --><p>z</p>'), '<p>z</p>');
  assert.equal(sanitize('<textarea><img src=x onerror=1></textarea>ok'), 'ok');
  assert.equal(sanitize('x <y'), 'x &lt;y');
  assert.equal(sanitize('<a href=\'https://a.example/"onmouseover="x\'>q</a>'), '<a href="https://a.example/%22onmouseover=%22x" target="_blank" rel="noopener noreferrer">q</a>');
  assert.equal(safeHref('data:text/html,<script>'), null);
  assert.equal(safeHref('//evil.example'), null);
  assert.equal(sanitize(null), '');
});

test('views escape every string from ADO', () => {
  const evil = item(66, { title: '<script>alert(1)</script>', state: '<b>x</b>', tags: ['<i>t</i>'], assignee: { name: '<img src=x>', email: '' }, url: 'javascript:alert(1)' });
  const row = rowHtml(evil, {});
  assert.ok(!row.includes('<script>') && !row.includes('<img') && !row.includes('<b>x') && !row.includes('<i>t'));
  assert.equal(safeUrl(evil.url), '#');
  const v = {
    settings: cleanSettings({ areas: ['A'], people: [] }), views: [], items: [evil], seen: {}, waiting: false, newer: '', refreshing: false, refreshError: '', dispatch: false,
    snap: { fetchedAt: null, me: null, categories: {}, iterations: {}, currentIterations: [] }, ado: { state: 'ready' }
  };
  const page = render(v, { view: 'all', filters: {}, sort: 'changed' }, NOW, true);
  assert.ok(!page.includes('<script>alert'));
  const pane = detail(v, { item: evil, details: { html: { description: '<script>x</script><p>ok</p>' }, comments: [{ html: '<img src=x onerror=1>', by: { name: '<b>n</b>' }, date: null }], history: [], related: [] } }, NOW);
  assert.ok(!pane.includes('<script>') && !pane.includes('onerror') && !pane.includes('<b>n') && !pane.includes('javascript:'));
  assert.match(pane, /<p>ok<\/p>/);
  const c = confirmHtml({ title: 'Change?', item: evil, connection: '<c>', lines: ['<x>'], action: 'Save' });
  assert.ok(!c.includes('<script>') && !c.includes('<x>') && !c.includes('<c>'));
});
