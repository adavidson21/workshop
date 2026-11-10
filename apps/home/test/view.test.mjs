// Home: the page from Docket's summary (docs/summaries.md) and the page states. Docket's own rules for these
// numbers, the day plan and Wrap up are tested in Docket (test/summary.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentCounts, boardFromSummary, fmt12, greeting, initials, profileForm, render, withNames, wrapFromDay, yourDayCard } from '../js/view.js';
import { directory } from '../../../shared/people.js';

const TODAY = '2026-10-21';
// A board as Home builds it from Docket's `board` card.
const board = (o = {}) => Object.assign({ total: 0, open: 0, focus: { total: 0, done: 0 }, triage: 0, overdue: 0, dueWeek: 0, nudges: 0, cameBack: 0, upNext: [], team: [] }, o);
const row = (id, o) => Object.assign({ id, title: 'Task ' + id, list: '', listId: 'l_main', due: null, people: [], triaged: true }, o);

test('boardFromSummary: today\'s counts with Up next and the team; null when the card has no today', () => {
  const card = { id: 'board', kind: 'board', updatedAt: 1, days: { [TODAY]: { total: 9, open: 7, focus: { total: 2, done: 1 }, triage: 2, overdue: 1, dueWeek: 1 } },
    upNext: [row('c'), row('a'), row('d'), row('x')], team: [{ id: 'p_a', name: 'DevA', open: 2, waiting: 0 }] };
  const b = boardFromSummary(card, TODAY);
  assert.deepEqual(b.focus, { total: 2, done: 1, tasks: [] });
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

test('Your day: one button, Wrap up when due, Day wrapped once done, Pick today\'s tasks when Today is empty', () => {
  const v = { now: new Date(2026, 10, 4, 16, 45), profile: {}, agents: { state: 'browser' }, board: { total: 3, open: 1, focus: { total: 1, done: 0, tasks: [] }, triage: 0, overdue: 0, dueWeek: 0, upNext: [], team: [] } };
  const due = render({ ...v, wrap: { wrapped: false, due: true, receipts: 2 } });
  assert.match(due, /class="btn primary" data-open="prioritizer" data-path="shutdown" title="[^"]*2 receipts offered to Rapport today\."/);
  const early = render({ ...v, wrap: { wrapped: false, due: false, receipts: 0 } });
  assert.match(early, /class="btn primary" data-open="prioritizer" data-path="today">Open Docket/);
  assert.match(render({ ...v, wrap: { wrapped: true, due: true, receipts: 0 } }), /data-path="shutdown"[^>]*>[\s\S]*?Day wrapped</);
  const empty = render({ ...v, board: { ...v.board, focus: { total: 0, done: 0, tasks: [] } }, wrap: { wrapped: false, due: false, receipts: 0 } });
  assert.match(empty, /data-path="today">[\s\S]*?Pick today's tasks</);
  assert.equal((due.match(/class="btn primary"/g) || []).length, 1, 'one button on the card');
});

test('header (Home 3.0.0): the greeting and one More menu; Weekly status as a button on Friday afternoons', () => {
  const v = { now: new Date(2026, 10, 4, 9), profile: { name: 'Sam' }, agents: { state: 'browser' }, board: { total: 0, open: 0, focus: { total: 0, done: 0 } } };
  const html = render(v);
  const tools = html.slice(html.indexOf('<div class="htools">'), html.indexOf('</header>'));
  assert.match(tools, /<details class="hmore"/);
  assert.match(tools, /class="mi" role="menuitem" data-status>/);
  assert.match(tools, /data-edit-profile>[\s\S]*?Edit profile/);
  assert.doesNotMatch(tools, /class="hbtn[^"]*" data-open=/, 'no day actions in the header');
  assert.doesNotMatch(tools, /class="btn" data-status/);
  const fri = render({ ...v, now: new Date(2026, 10, 6, 14) });
  assert.match(fri.slice(0, fri.indexOf('</header>')), /class="btn" data-status>/);
});

test('Your day: the block on now, Today\'s tasks under their blocks, Not scheduled, and one footer line', () => {
  const now = new Date(2026, 10, 10, 13, 15);
  const b = board({ total: 6, open: 5, triage: 7, overdue: 2, dueWeek: 1, nudges: 3, cameBack: 1,
    focus: { total: 4, done: 1, tasks: [{ id: 't1', title: 'Write the plan', done: false }, { id: 't2', title: 'Review PR 77', done: true }, { id: 'x', title: 'Loose <one>', done: false }, { id: 'y', title: 'Another', done: false }] } });
  const html = yourDayCard(b, day, now, null);
  assert.match(html, /class="card yourday w2"/);
  assert.match(html, /<span class="nowtag">Now<\/span><b>Meetings<\/b> until 3:00 PM, then Admin/);
  assert.match(html, /<li class="ydblk now"><span class="num">1:00 PM<\/span>Meetings<\/li>/);
  assert.ok(html.indexOf('Write the plan') > html.indexOf('Meetings') && html.indexOf('Not scheduled') > html.indexOf('Write the plan'));
  assert.match(html, /Not scheduled<\/li>[\s\S]*Loose &lt;one&gt;/);
  assert.match(html, /1 of 4 done/);
  assert.match(html, /7 to sort/); assert.match(html, /2 overdue/); assert.match(html, /1 due this week/);
  assert.doesNotMatch(html, /follow-up|came back/, 'follow-ups and came back are Needs you rows (Docket\'s needs card)');
  const noPlan = yourDayCard(b, null, now, null);
  assert.match(noPlan, /No plan today\. <button class="lnk" data-open="prioritizer" data-path="day\/today">Plan the day/);
  assert.doesNotMatch(noPlan, /ydblk/);
  const many = yourDayCard(board({ total: 12, open: 12, focus: { total: 12, done: 0, tasks: Array.from({ length: 10 }, (_, i) => ({ id: 'm' + i, title: 'Task ' + i, done: false })) } }), null, now, null);
  assert.equal((many.match(/data-path="task\//g) || []).length, 8, 'at most 8 tasks');
  assert.match(many, /and 2 more/);
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
  ]);
  assert.deepEqual(inboxRows([], {}), []);
});

test('Needs you (Docket 7.0.0): Docket\'s needs rows, and one row for pull requests when Dispatch has one too', async () => {
  const { inboxRows } = await import('../js/view.js');
  const cards = (list) => new Map([['needs', { kind: 'list', rows: list }]]);
  const docket = { app: 'prioritizer', name: 'Docket', cards: cards([{ id: 'prs', title: '2 PRs blocked on you', note: 'Review in Docket', route: 'today', flag: 'urgent' }, { id: 'nudges', title: '1 follow-up due', route: 'today', flag: 'waiting' }]) };
  const dispatch = { app: 'agents', name: 'Dispatch', cards: cards([{ id: 'prs', title: '5 pull requests waiting for your review', note: 'a, b', route: 'reviews' }]) };
  const rows = inboxRows([docket, dispatch], {});
  assert.deepEqual(rows.map(r => [r.appName, r.title, r.note, r.flag]), [
    ['Docket', '2 PRs blocked on you', '5 pull requests waiting for your review in Dispatch', 'urgent'],
    ['Docket', '1 follow-up due', '', 'waiting']]);
  assert.equal(inboxRows([dispatch], {})[0].appName, 'Dispatch', 'without Docket\'s row, Dispatch\'s stays');
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

test('dashboard: Coming up from every app\'s upcoming card, soonest first, two weeks ahead and a week late at most', async () => {
  const { upcomingRows, upcomingCard, dueLabel } = await import('../js/view.js');
  const today = '2026-11-10';
  const card = rows => new Map([['upcoming', { id: 'upcoming', kind: 'list', updatedAt: 1, rows }]]);
  const byApp = [
    { app: 'receipts', name: 'Rapport', cards: card([{ id: 'a', title: '1:1 with Dev A', due: '2026-11-12', note: '1:1', route: '1on1s/p_a' }, { id: 'old', title: 'Long gone', due: '2026-10-01' }]) },
    { app: 'runway', name: 'Runway', cards: card([{ id: 'm', title: 'Search live', due: '2026-11-10', note: 'Platform' }, { id: 'far', title: 'Next year', due: '2027-03-01' }, { id: 'late', title: 'Slipped', due: '2026-11-07' }, { title: 'No date' }]) },
    { app: 'notes', name: 'Folio', cards: null }
  ];
  const rows = upcomingRows(byApp, today);
  assert.deepEqual(rows.map(r => r.title), ['Slipped', 'Search live', '1:1 with Dev A']);
  assert.equal(dueLabel('2026-11-10', today), 'Today');
  assert.equal(dueLabel('2026-11-11', today), 'Tomorrow');
  assert.equal(dueLabel('2026-11-07', today), '3 days late');
  const html = upcomingCard(rows, today);
  assert.match(html, /Coming up/);
  assert.match(html, /data-open="receipts" data-path="1on1s\/p_a"/);
  assert.match(html, /class="ud num late"/);
  assert.equal(upcomingCard([], today), '');
});

test('dashboard: the page is one .dash grid with Your day spanning two columns, and no separate Day plan card', async () => {
  const { dayBlocks } = await import('../js/view.js');
  const now = new Date(2026, 10, 10, 10, 15);
  const day = { blocks: [{ name: 'Standup', at: '09:00', until: '09:30', tasks: [] }, { name: 'Deep <focus>', at: '10:00', until: '12:00', tasks: [{ id: 'x1', title: 'Ship <it>', done: true }] }] };
  const blocks = dayBlocks(day, 10 * 60 + 15);
  assert.deepEqual(blocks.map(b => [b.past, b.now]), [[true, false], [false, true]]);
  const b = board({ total: 3, open: 3, focus: { total: 2, done: 1, tasks: [{ id: 'x1', title: 'Ship <it>', done: true }, { id: 'x2', title: 'Review', done: false }] } });
  const html = render({ now, profile: {}, board: b, day, agents: { state: 'off' }, upcoming: [], week: [] });
  assert.match(html, /<div class="dash cols">/);
  assert.match(html, /class="card yourday w2"/);
  assert.match(html, /data-path="task\/x1">Ship &lt;it&gt;</);
  assert.match(html, /<b>Deep &lt;focus&gt;<\/b> until 12:00 PM/);
  assert.doesNotMatch(html, /Day plan<\/h2>|class="tile/);
});
