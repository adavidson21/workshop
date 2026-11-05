// Home: the page from Docket's summary (docs/summaries.md) and the page states. Docket's own rules for these
// numbers, the day plan and Wrap up are tested in Docket (test/summary.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentCounts, boardFromSummary, fmt12, greeting, initials, nowFromDay, profileForm, render, wrapFromDay } from '../js/view.js';

const TODAY = '2026-10-21';
// A board as Home builds it from Docket's `board` card.
const board = (o = {}) => Object.assign({ total: 0, open: 0, focus: { total: 0, done: 0 }, triage: 0, overdue: 0, dueWeek: 0, upNext: [], team: [] }, o);
const row = (id, o) => Object.assign({ id, title: 'Task ' + id, list: '', listId: 'l_main', due: null, people: [], triaged: true }, o);

test('boardFromSummary: today\'s counts with Up next and the team; null when the card has no today', () => {
  const card = { id: 'board', kind: 'board', updatedAt: 1, days: { [TODAY]: { total: 9, open: 7, focus: { total: 2, done: 1 }, triage: 2, overdue: 1, dueWeek: 1 } },
    upNext: [row('c'), row('a'), row('d'), row('x')], team: [{ name: 'DevA', open: 2, waiting: 0 }] };
  const b = boardFromSummary(card, TODAY);
  assert.deepEqual(b.focus, { total: 2, done: 1 });
  assert.equal(b.open, 7);
  assert.deepEqual(b.upNext.map(x => x.id), ['c', 'a', 'd'], 'at most 3');
  assert.deepEqual(b.team, [{ name: 'DevA', open: 2, waiting: 0 }]);
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
});

test('the page: profile, empty board, and escaping', () => {
  const now = new Date(2026, 9, 21, 9);
  const empty = render({ now, profile: {}, board: board(), agents: { state: 'browser' } });
  assert.match(empty, /Good morning</);
  assert.match(empty, /Add your name/);
  assert.match(empty, /No tasks yet/);
  assert.ok(!empty.includes('<h2>Dispatch</h2>'), 'no Dispatch card until it is connected');
  const html = render({ now, profile: { name: 'Test User', role: 'EM <b>' }, board: board({ total: 1, open: 1, upNext: [row('x', { title: '<img src=x onerror=alert(1)>' })] }), agents: { state: 'ready', needYou: 2, working: 1 } });
  assert.match(html, /Good morning, Test</);
  assert.ok(!html.includes('<img') && !html.includes('<b>'));
  assert.match(html, /Need you/);
  assert.ok(!profileForm({ name: '"><script>' }).includes('<script>'));
});

test('a board note shows when the board cannot be read', () => {
  const html = render({ now: new Date(), profile: {}, board: null, boardNote: 'Your board was saved by a newer Docket.', agents: { state: 'loading' } });
  assert.match(html, /newer Docket/);
});

/* ---------- Now card and Wrap up (Docket's `day` card) ---------- */
const day = { blocks: [
  { name: 'Deep focus', at: '09:00', until: '11:00', tasks: [] },
  { name: 'Meetings', at: '13:00', until: '15:00', tasks: [{ id: 't2', title: 'Review PR 77', done: true }, { id: 't1', title: 'Write the plan', done: false }] },
  { name: 'Admin', at: '15:00', until: '16:00', tasks: [] }
], wrapAt: '16:30', wrapped: false, offered: 2 };

test('Now: the block on now, when it ends and what is next', () => {
  const n = nowFromDay(day, 10 * 60 + 15);
  assert.equal(n.current.name, 'Deep focus');
  assert.equal(n.current.until, '11:00');
  assert.equal(n.next.name, 'Meetings');
  const m = nowFromDay(day, 13 * 60 + 30);
  assert.deepEqual(m.current.tasks.map(t => [t.title, t.done]), [['Review PR 77', true], ['Write the plan', false]]);
  const gap = nowFromDay(day, 12 * 60);
  assert.equal(gap.current, null);
  assert.equal(gap.next.name, 'Meetings');
});

test('no Now card on a day with no blocks or after the last one', () => {
  assert.equal(nowFromDay({ blocks: [] }, 600), null);
  assert.equal(nowFromDay(null, 600), null);
  assert.equal(nowFromDay(day, 16 * 60 + 30), null);
});

test('the Now card shows times on a 12-hour clock', () => {
  const now = new Date(2026, 10, 3, 10, 15);
  const html = render({ now, profile: {}, board: board({ total: 1, open: 1, upNext: [row('a')] }), agents: { state: 'browser' }, dayNow: nowFromDay(day, 10 * 60 + 15) });
  assert.match(html, /until 11:00 AM/);
  assert.match(html, /at 1:00 PM/);
  assert.ok(!/\b1[3-9]:\d\d\b/.test(html), 'no 24-hour times');
  assert.equal(fmt12('00:05'), '12:05 AM'); assert.equal(fmt12('12:30'), '12:30 PM');
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

test('symbols: tiles carry icons and tone, rows use signals and quiet people', () => {
  const b = board({ total: 2, open: 2, triage: 1, overdue: 1,
    upNext: [row('a', { title: 'Late', list: 'Main', listId: 'l1', due: '2026-10-19', people: ['Dana Lee'] }), row('b', { title: 'Raw', list: 'Side', listId: 'l2', triaged: false })],
    team: [{ name: 'Dana Lee', open: 1, waiting: 0 }, { name: 'Idle', open: 0, waiting: 0 }] });
  const html = render({ now: new Date(2026, 9, 20, 9), profile: { name: 'A' }, board: b, agents: { state: 'off' } });
  assert.match(html, /class="tile danger"/);
  assert.match(html, /class="tile warn"/);
  assert.match(html, /class="sig danger txt"[^>]*aria-label="Overdue\. Due yesterday"/);
  assert.match(html, /<i class="av">DL<\/i>/);
  assert.match(html, /aria-label="List: Main"/);
  assert.match(html, /aria-label="No estimate yet"/);
  assert.ok(!html.includes('>Idle<'), 'people with nothing open are left out');
  assert.ok(!html.includes('<h2>Dispatch</h2>'));
  assert.equal(initials('DevA'), 'DA');
  assert.equal(initials('Dana Lee'), 'DL');
});
