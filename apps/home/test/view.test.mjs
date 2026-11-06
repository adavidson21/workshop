// Home: the page from Docket's summary (docs/summaries.md) and the page states. Docket's own rules for these
// numbers, the day plan and Wrap up are tested in Docket (test/summary.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentCounts, boardFromSummary, fmt12, greeting, initials, profileForm, render, todayCard, withNames, wrapFromDay } from '../js/view.js';
import { directory } from '../../../shared/people.js';

const TODAY = '2026-10-21';
// A board as Home builds it from Docket's `board` card.
const board = (o = {}) => Object.assign({ total: 0, open: 0, focus: { total: 0, done: 0 }, triage: 0, overdue: 0, dueWeek: 0, nudges: 0, cameBack: 0, upNext: [], team: [] }, o);
const row = (id, o) => Object.assign({ id, title: 'Task ' + id, list: '', listId: 'l_main', due: null, people: [], triaged: true }, o);

test('boardFromSummary: today\'s counts with Up next and the team; null when the card has no today', () => {
  const card = { id: 'board', kind: 'board', updatedAt: 1, days: { [TODAY]: { total: 9, open: 7, focus: { total: 2, done: 1 }, triage: 2, overdue: 1, dueWeek: 1 } },
    upNext: [row('c'), row('a'), row('d'), row('x')], team: [{ id: 'p_a', name: 'DevA', open: 2, waiting: 0 }] };
  const b = boardFromSummary(card, TODAY);
  assert.deepEqual(b.focus, { total: 2, done: 1 });
  assert.equal(b.open, 7);
  assert.deepEqual(b.upNext.map(x => x.id), ['c', 'a', 'd'], 'at most 3');
  assert.deepEqual(b.team, [{ id: 'p_a', name: 'DevA', open: 2, waiting: 0 }]);
  assert.equal(boardFromSummary(card, '2026-10-30'), null, 'stale');
  assert.equal(boardFromSummary(null, TODAY), null);
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
  assert.equal(greeting(new Date(2026, 9, 21, 19), true), 'Evening', 'with a name it is just the time of day');
});

test('the page: profile, empty board, and escaping', () => {
  const now = new Date(2026, 9, 21, 9);
  const empty = render({ now, profile: {}, board: board(), agents: { state: 'browser' } });
  assert.match(empty, /Good morning</);
  assert.match(empty, /Add your name/);
  assert.match(empty, /No tasks yet/);
  assert.ok(!empty.includes('<h2>Dispatch</h2>'), 'no Dispatch card until it is connected');
  const html = render({ now, profile: { name: 'Test User', role: 'EM <b>' }, board: board({ total: 1, open: 1, upNext: [row('x', { title: '<img src=x onerror=alert(1)>' })] }), agents: { state: 'ready', needYou: 2, working: 1 } });
  assert.match(html, /Morning, Test</);
  assert.ok(!html.includes('<img') && !html.includes('<b>'));
  assert.match(html, /Need you/);
  assert.ok(!profileForm({ name: '"><script>' }).includes('<script>'));
});

test('a board note shows when the board cannot be read', () => {
  const html = render({ now: new Date(), profile: {}, board: null, boardNote: 'Your board was saved by a newer Docket.', agents: { state: 'loading' } });
  assert.match(html, /newer Docket/);
});

/* ---------- Wrap up (Docket's `day` card) ---------- */
const day = { blocks: [
  { name: 'Deep focus', at: '09:00', until: '11:00', tasks: [] },
  { name: 'Meetings', at: '13:00', until: '15:00', tasks: [{ id: 't2', title: 'Review PR 77', done: true }, { id: 't1', title: 'Write the plan', done: false }] },
  { name: 'Admin', at: '15:00', until: '16:00', tasks: [] }
], wrapAt: '16:30', wrapped: false, offered: 2 };

test('fmt12: a 12-hour clock', () => {
  assert.equal(fmt12('00:05'), '12:05 AM'); assert.equal(fmt12('12:30'), '12:30 PM'); assert.equal(fmt12('13:00'), '1:00 PM');
});

test('Wrap up from the day card: due from its time, wrapped, and receipts offered', () => {
  assert.deepEqual(wrapFromDay(day, 16 * 60 + 29), { wrapped: false, due: false, receipts: 2 });
  assert.equal(wrapFromDay(day, 16 * 60 + 30).due, true);
  assert.equal(wrapFromDay({ ...day, wrapAt: null }, 23 * 60).due, false, 'a day off');
  assert.equal(wrapFromDay({ ...day, wrapped: true }, 9 * 60).wrapped, true);
  assert.deepEqual(wrapFromDay(null, 9 * 60), { wrapped: false, due: false, receipts: 0 });
});

test('Wrap up step: primary when due, says Day wrapped once done', () => {
  const v = { now: new Date(2026, 10, 4, 16, 45), profile: {}, agents: { state: 'browser' }, board: { total: 3, open: 1, focus: { total: 1, done: 0 }, triage: 0, overdue: 0, dueWeek: 0, upNext: [], team: [] } };
  const due = render({ ...v, wrap: { wrapped: false, due: true, receipts: 2 } });
  assert.match(due, /class="hbtn primary" data-open="prioritizer" data-path="shutdown" aria-label="Wrap up the day" title="[^"]*2 receipts offered to Rapport today\."/);
  const early = render({ ...v, wrap: { wrapped: false, due: false, receipts: 0 } });
  assert.match(early, /class="hbtn" data-open="prioritizer" data-path="shutdown" aria-label="Wrap up the day"/);
  assert.match(render({ ...v, wrap: { wrapped: true, due: true, receipts: 0 } }), /class="hbtn done" data-open="prioritizer" data-path="shutdown" aria-label="Day wrapped"/);
});

test('Today card: Docket\'s counts, each opening Docket\'s Today; no Up next, Now or People on Home', () => {
  const b = board({ total: 4, open: 3, focus: { total: 2, done: 1 }, triage: 1, overdue: 1, dueWeek: 2, nudges: 2, cameBack: 1, upNext: [
    row('a', { title: 'Late', list: 'Main', listId: 'l1', due: '2026-10-19', people: ['Dana Lee'] })], team: [{ id: 'p_d', name: 'Dana Lee', open: 1, waiting: 0 }] });
  const html = render({ now: new Date(2026, 9, 20, 9), profile: { name: 'A' }, board: b, agents: { state: 'off' } });
  assert.match(html, /<h2>Today<\/h2>/);
  assert.match(html, /class="tile danger"/, 'overdue');
  assert.match(html, /class="tile warn"[^>]*title="1 task to sort"/, 'triage');
  assert.match(html, /title="2 follow-ups due on work you handed over"/);
  assert.match(html, /1 came back/);
  assert.equal((html.match(/data-path="today"/g) || []).length, 5, 'four tiles and Open Today all open Docket\'s Today');
  assert.ok(!html.includes('Up next') && !html.includes('Dana Lee') && !html.includes('Open Day'), 'Docket\'s own views stay in Docket');
  assert.ok(!html.includes('<h2>Dispatch</h2>'));
  assert.match(todayCard(board({ open: 0 })), /class="tile zero"/);
  assert.equal(initials('DevA'), 'DA');
  assert.equal(initials('Dana Lee'), 'DL');
});

test('withNames: names for Up next and team ids come from the directory, groups included', () => {
  const dir = directory({ schema: 'settings.people', version: 2, items: [
    { id: 'p_a', kind: 'person', name: 'Dana Lee', handle: 'dana', relation: 'peer' },
    { id: 'g_l', kind: 'group', name: 'Leadership', handle: 'leadership', members: ['p_a'] }] });
  const b = withNames(board({ upNext: [row('t', { who: ['p_a', 'g_l', 'p_gone'] })], team: [{ id: 'p_a', name: 'Old', open: 1, waiting: 0 }, { name: 'no id', open: 1, waiting: 0 }] }), dir);
  assert.deepEqual(b.upNext[0].people, ['Dana Lee', 'Leadership', 'Unknown']);
  assert.deepEqual(b.team.map(m => m.name), ['Dana Lee']);
  assert.equal(withNames(null, dir), null);
});

test('Needs you: one list from every app, urgent first, with agents added', async () => {
  const { inboxRows } = await import('../js/view.js');
  const cards = (list) => new Map([['needs', { kind: 'list', rows: list }]]);
  const rows = inboxRows([
    { app: 'slate', name: 'Slate', cards: cards([{ id: 'w1', title: '#7 Export', note: 'Decide who builds it', route: 'item/w1' }, { id: 'w2', title: 'Asking', note: 'An agent is asking', route: 'item/w2', flag: 'urgent' }]) },
    { app: 'receipts', name: 'Rapport', cards: cards([{ id: 'p1', title: '1:1 with Ana', flag: 'waiting', route: '1on1s' }]) },
    { app: 'notes', name: 'Notes', cards: null }
  ], { agents: { state: 'ready', needYou: 1 } });
  assert.deepEqual(rows.map(r => [r.appName, r.title, r.flag]), [
    ['Dispatch', '1 agent waiting for an answer', 'urgent'], ['Slate', 'Asking', 'urgent'], ['Slate', '#7 Export', ''],
    ['Rapport', '1:1 with Ana', 'waiting']
  ], 'Docket\'s counts are on the Today card, not repeated here');
  assert.deepEqual(inboxRows([], {}), []);
});

test('weekly status: a Markdown draft from every app that logged something', async () => {
  const { weekRows, statusDraft } = await import('../js/view.js');
  const week = weekRows([
    { app: 'prioritizer', name: 'Docket', cards: new Map([['done-week', { kind: 'list', title: 'Finished this week', count: 3, rows: [{ id: 't1', title: 'Ship the guide' }, { id: 't2', title: 'Fix login', note: 'Platform' }] }]]) },
    { app: 'slate', name: 'Slate', cards: new Map([['done-week', { kind: 'list', title: 'Decisions this week', rows: [] }]]) }
  ]);
  assert.equal(week.length, 1);
  const md = statusDraft(week, { name: 'Alex', now: new Date('2026-11-06T12:00:00') });
  assert.match(md, /^# Weekly status: Alex, week of /);
  assert.match(md, /## Finished this week\n\n- Ship the guide\n- Fix login \(Platform\)\n- and 1 more\n/);
  assert.match(md, /## Next week/);
  assert.match(statusDraft([], {}), /Nothing logged this week yet/);
});
