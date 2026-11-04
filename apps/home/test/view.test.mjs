// Home: the numbers from a synthetic Prioritizer board, and the page states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentCounts, render, summarize, greeting, profileForm } from '../js/view.js';
import { dayNow, initials } from '../js/view.js';

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
  assert.ok(!empty.includes('<h2>Dispatch</h2>'), 'no Dispatch card until it is connected');
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

/* ---------- Now card (Docket's day plan) ---------- */
const env = (col, extra) => Object.assign({ schema: 'prioritizer.' + col, version: 1, rev: 1, items: [] }, extra);
// Tuesday 2026-11-03; a 2-week sprint starting Monday 2026-11-02, so today is sprint day 2.
const sprint = { anchor: '2026-11-02', lengthWeeks: 2, workdays: [1, 2, 3, 4, 5], holidays: [] };
const blocks = [
  { id: 's1', name: 'Deep focus', around: '09:00', minutes: 120 },
  { id: 's2', name: 'Meetings', around: '13:00' },
  { id: 's3', name: 'Admin', around: '15:00', minutes: 60 }
];
const plan = (days = []) => ({
  settings: env('dayplan/settings', { meta: { sprint } }),
  templates: env('dayplan/templates', { items: [{ id: 'tp', name: 'Sprint day', days: [2, 3, 4, 5, 6, 7, 8, 9], sections: blocks }] }),
  days: env('dayplan/days/2026', { items: days })
});
const nowTasks = [{ id: 't1', title: 'Write the plan', rank: 1 }, { id: 't2', title: 'Review PR 77', rank: 0, done: true }];

test('Now shows the template block on now, with when it ends and what is next', () => {
  const n = dayNow(plan(), nowTasks, new Date(2026, 10, 3, 10, 15));
  assert.equal(n.current.name, 'Deep focus');
  assert.equal(n.current.until, '11:00');
  assert.equal(n.next.name, 'Meetings');
  assert.deepEqual(n.current.tasks, []);
});

test('Now uses the saved day: its blocks, lost ones skipped, and the tasks slotted in rank order', () => {
  const rec = { id: '2026-11-03', sections: [Object.assign({}, blocks[0], { lost: true }), blocks[1], blocks[2]], slots: [{ taskId: 't1', sectionId: 's2' }, { taskId: 't2', sectionId: 's2' }, { taskId: 'gone', sectionId: 's2' }] };
  const n = dayNow(plan([rec]), nowTasks, new Date(2026, 10, 3, 13, 30));
  assert.equal(n.current.name, 'Meetings');
  assert.equal(n.current.until, '15:00', 'a block with no length runs until the next one');
  assert.deepEqual(n.current.tasks.map(t => [t.title, t.done]), [['Review PR 77', true], ['Write the plan', false]]);
  const early = dayNow(plan([rec]), nowTasks, new Date(2026, 10, 3, 9, 30));
  assert.equal(early.current, null, 'the lost block is not on now');
  assert.equal(early.next.name, 'Meetings');
});

test('no Now card without a sprint, on a day off, or after the last block', () => {
  assert.equal(dayNow(null, nowTasks, new Date(2026, 10, 3, 10)), null);
  assert.equal(dayNow(Object.assign(plan(), { settings: null }), nowTasks, new Date(2026, 10, 3, 10)), null);
  assert.equal(dayNow(plan(), nowTasks, new Date(2026, 10, 7, 10)), null, 'Saturday');
  assert.equal(dayNow(plan(), nowTasks, new Date(2026, 10, 3, 16, 30)), null, 'after Admin ends');
  assert.equal(dayNow(plan(), nowTasks, new Date(2026, 10, 2, 10)), null, 'sprint day 1 has no template here');
});

test('Wrap up step: primary from an hour before day end on a working day; says Day wrapped once done', async () => {
  const { wrapState } = await import('../js/view.js');
  const settings = { schema: 'prioritizer.dayplan/settings', version: 1, items: [], meta: { sprint: { anchor: '2026-11-04', lengthWeeks: 2, workdays: [1, 2, 3, 4, 5], holidays: [], dayEnd: '17:30' } } };
  const today = '2026-11-04'; // a Wednesday
  assert.equal(wrapState({ settings }, today, 16 * 60 + 29).due, false);
  assert.equal(wrapState({ settings }, today, 16 * 60 + 30).due, true);
  assert.equal(wrapState({ settings }, '2026-11-07', 18 * 60).due, false, 'Saturday');
  assert.equal(wrapState({}, today, 15 * 60).due, true, 'no sprint: 15:00 as before');
  const offers = { items: [{ to: 'receipts', date: today }, { to: 'receipts', date: '2026-11-03' }, { to: 'other', date: today }] };
  const day = { id: today, events: [{ at: 'x', type: 'shutdown' }] };
  assert.deepEqual(wrapState({ settings, offers, day }, today, 9 * 60), { wrapped: true, due: false, receipts: 1 });
  const v = { now: new Date(2026, 10, 4, 16, 45), profile: {}, agents: { state: 'browser' }, board: { total: 3, open: 1, focus: { total: 1, done: 0 }, triage: 0, overdue: 0, dueWeek: 0, upNext: [], team: [] } };
  const due = render({ ...v, wrap: { wrapped: false, due: true, receipts: 2 } });
  assert.match(due, /class="hbtn primary" data-open="prioritizer" data-path="shutdown" aria-label="Wrap up the day" title="[^"]*2 receipts offered to Receipts today\."/);
  const early = render({ ...v, wrap: { wrapped: false, due: false, receipts: 0 } });
  assert.match(early, /class="hbtn" data-open="prioritizer" data-path="shutdown" aria-label="Wrap up the day"/);
  assert.match(render({ ...v, wrap: { wrapped: true, due: true, receipts: 0 } }), /class="hbtn done" data-open="prioritizer" data-path="shutdown" aria-label="Day wrapped"/);
});

test('symbols: tiles carry icons and tone, rows use signals, quiet people and Queue counts', () => {
  const board = summarize({ tasks: [
    { id: 'a', title: 'Late', listId: 'l1', rank: 1, value: 3, effort: 'S', due: '2026-10-19', people: ['Dana Lee'] },
    { id: 'b', title: 'Raw', listId: 'l2', rank: 2 }
  ], lists: [{ id: 'l1', name: 'Main' }, { id: 'l2', name: 'Side' }], people: [{ name: 'Dana Lee' }, { name: 'Idle' }] }, '2026-10-20');
  const html = render({ now: new Date(2026, 9, 20, 9), profile: { name: 'A' }, board, agents: { state: 'off' } });
  assert.match(html, /class="tile danger"/);
  assert.match(html, /class="tile warn"/);
  assert.match(html, /class="sig danger txt"[^>]*aria-label="Overdue\. Due yesterday"/);
  assert.match(html, /<i class="av">DL<\/i>/);
  assert.match(html, /aria-label="List: Main"/);
  assert.match(html, /aria-label="No estimate yet"/);
  assert.ok(!html.includes('>Idle<'), 'people with nothing open are left out');
  assert.ok(!html.includes('<h2>Dispatch</h2>'));
  assert.match(queueCard({ fetchedAt: 'x', total: 3, unassigned: 0, stale: 0, changedMine: 0 }), /class="calm"/);
  assert.match(queueCard({ fetchedAt: 'x', total: 3, unassigned: 2, stale: 0, changedMine: 0 }), /class="pill warn"[^>]*aria-label="2 Unassigned"/);
  assert.equal(initials('DevA'), 'DA');
  assert.equal(initials('Dana Lee'), 'DL');
});
