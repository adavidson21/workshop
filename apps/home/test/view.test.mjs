// Home: the numbers from a synthetic Prioritizer board, and the page states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentCounts, render, summarize, greeting, profileForm } from '../js/view.js';

const TODAY = '2026-10-21';
const lists = [{ id: 'l_main', name: 'Main', parentId: null }, { id: 'l2', name: 'Side', parentId: null }];
const people = [{ id: 'deva', name: 'DevA' }, { id: 'devb', name: 'DevB' }, { id: 'devc', name: 'DevC' }];
const t = (id, o) => Object.assign({ id, title: 'Task ' + id, listId: 'l_main', done: false, rank: 0, value: 3, effort: 'M', ageFrom: TODAY, people: [] }, o);
const tasks = [
  t('a', { rank: 3, focusOn: TODAY }),
  t('b', { rank: 1, focusOn: TODAY, done: true, doneAt: TODAY }),
  t('c', { rank: 2, value: null, effort: null, people: ['DevA'] }),           // untriaged
  t('d', { rank: 4, due: '2026-10-20', people: ['deva'] }),                     // overdue
  t('e', { rank: 5, due: '2026-10-28', listId: 'l2' }),                        // due in 7 days
  t('f', { rank: 6, due: '2026-10-29' }),                                      // due in 8 days
  t('g', { rank: 0, waiting: true, people: ['DevB'] }),                         // waiting: not up next
  t('h', { rank: 7, value: 4, ageFrom: '2026-10-15' }),                        // stale (value 4 window 2, 6 days)
  t('i', { rank: 8, focusOn: TODAY, done: true, wontDo: true, doneAt: TODAY }), // won't do: not on Today
  t('z', { listId: 'gone' })                                                    // list not on the board
];

test('counts Today, triage, overdue and due this week like Prioritizer', () => {
  const s = summarize({ tasks, lists, people }, TODAY);
  assert.deepEqual(s.focus, { total: 2, done: 1 });
  assert.equal(s.triage, 2);
  assert.equal(s.overdue, 1);
  assert.equal(s.dueWeek, 1);
  assert.equal(s.open, 7);
  assert.equal(s.total, 9);
});

test('up next is the top 3 open by rank, without waiting tasks', () => {
  const s = summarize({ tasks, lists, people }, TODAY);
  assert.deepEqual(s.upNext.map(x => x.id), ['c', 'a', 'd']);
  assert.equal(s.upNext[2].due, '2026-10-20');
  assert.equal(s.upNext[0].list, 'Main');
  assert.equal(summarize({ tasks, lists: lists.slice(0, 1), people }, TODAY).upNext[0].list, '');
});

test('people: open and waiting per person, case-insensitive, busiest first', () => {
  const s = summarize({ tasks, lists, people }, TODAY);
  assert.deepEqual(s.team, [{ name: 'DevA', open: 2, waiting: 0 }, { name: 'DevB', open: 1, waiting: 1 }, { name: 'DevC', open: 0, waiting: 0 }]);
});

test('agent counts from the connector state', () => {
  assert.deepEqual(agentCounts(null), { needYou: 0, working: 0 });
  const st = { liveMode: { live: { permissions: [{}], questions: [{}, {}], sessions: { a: { status: 'busy' }, b: { status: 'idle' }, c: {} } } } };
  assert.deepEqual(agentCounts(st), { needYou: 3, working: 1 });
});

test('greeting by time of day', () => {
  assert.equal(greeting(new Date(2026, 9, 21, 8)), 'Good morning');
  assert.equal(greeting(new Date(2026, 9, 21, 13)), 'Good afternoon');
  assert.equal(greeting(new Date(2026, 9, 21, 19)), 'Good evening');
});

test('the page: profile, empty board, and escaping', () => {
  const now = new Date(2026, 9, 21, 9);
  const empty = render({ now, profile: {}, board: summarize({}, TODAY), agents: { state: 'browser' } });
  assert.match(empty, /Good morning</);
  assert.match(empty, /Add your name/);
  assert.match(empty, /No tasks yet/);
  assert.match(empty, /needs Workshop running/);
  const bad = [t('x', { title: '<img src=x onerror=alert(1)>' })];
  const html = render({ now, profile: { name: 'Test User', role: 'EM <b>' }, board: summarize({ tasks: bad, lists, people: [] }, TODAY), agents: { state: 'ready', needYou: 2, working: 1 } });
  assert.match(html, /Good morning, Test</);
  assert.ok(!html.includes('<img') && !html.includes('<b>'));
  assert.match(html, /Need you/);
  assert.ok(!profileForm({ name: '"><script>' }).includes('<script>'));
});

test('a board note shows when the board cannot be read', () => {
  const html = render({ now: new Date(), profile: {}, board: null, boardNote: 'Your board was saved by a newer Prioritizer.', agents: { state: 'loading' } });
  assert.match(html, /newer Prioritizer/);
});

// The Queue card, from the Queue app's collections (read-only).
import { queueCard, queueSummary } from '../js/view.js';

test('queueSummary: no card until the queue has area paths; counts unassigned, stale and mine changed', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  const settings = { schema: 'queue.settings', version: 1, rev: 1, items: [], meta: { areas: ['Web App\\Team A'], staleDays: 7 } };
  const snapshot = { schema: 'queue.snapshot', version: 1, rev: 1, meta: { fetchedAt: '2026-10-15T11:00:00Z', me: { name: 'Engineer A', email: 'engineer.a@example.com' } }, items: [
    { id: '1', rev: 5, assignee: { name: 'Engineer A', email: 'Engineer.A@example.com' }, changed: '2026-10-14T00:00:00Z' },
    { id: '2', rev: 2, assignee: null, changed: '2026-10-01T00:00:00Z' },
    { id: '3', rev: 9, assignee: { name: 'Engineer A', email: 'engineer.a@example.com' }, changed: '2026-10-14T00:00:00Z' },
    { id: '4', rev: 1, assignee: { name: 'Dev One', email: 'dev.one@example.com' }, changed: '2026-10-14T00:00:00Z' }
  ] };
  const seen = { schema: 'queue.seen', version: 1, rev: 1, items: [{ id: '1', rev: 3 }, { id: '4', rev: 0 }] };
  assert.equal(queueSummary({ settings: null, snapshot, seen }, now), null);
  assert.equal(queueSummary({ settings: { ...settings, meta: { areas: [] } }, snapshot, seen }, now), null);
  assert.deepEqual(queueSummary({ settings, snapshot, seen }, now), { fetchedAt: '2026-10-15T11:00:00Z', total: 4, unassigned: 1, stale: 1, changedMine: 1 });
  assert.equal(queueSummary({ settings: { ...settings, meta: { ...settings.meta, meEmail: 'dev.one@example.com' } }, snapshot, seen }, now).changedMine, 1);
  assert.equal(queueSummary({ settings, snapshot: { ...snapshot, version: 2 }, seen }, now).total, 0, 'a newer snapshot is not read');
  const html = queueCard(queueSummary({ settings, snapshot, seen }, now));
  assert.match(html, /<h2>Queue<\/h2>/);
  assert.match(html, /data-open="queue"/);
  assert.match(html, /Yours, changed/);
  assert.equal(queueCard(null), '');
  assert.match(queueCard({ fetchedAt: null, total: 0, unassigned: 0, stale: 0, changedMine: 0 }), /Open the Queue to load/);
});
