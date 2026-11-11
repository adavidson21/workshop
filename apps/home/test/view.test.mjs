// Home, the Needs you panel: rows from every app's summary (docs/summaries.md) and the panel's states. Docket's own
// rules for its rows are tested in Docket (test/summary.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentCounts, boardFromSummary, render } from '../js/view.js';

const TODAY = '2026-10-21';

test('boardFromSummary: today\'s total for Get started; null when the card has no today', () => {
  const card = { id: 'board', kind: 'board', updatedAt: 1, days: { [TODAY]: { total: 9, open: 7, focus: { total: 2, done: 1 }, triage: 2, overdue: 1, dueWeek: 1 } }, upNext: [], team: [] };
  assert.equal(boardFromSummary(card, TODAY).total, 9);
  assert.equal(boardFromSummary(card, '2026-10-30'), null, 'stale');
  assert.equal(boardFromSummary(null, TODAY), null);
});

test('agent counts from the connector state', () => {
  assert.deepEqual(agentCounts(null), { needYou: 0, working: 0 });
  const st = { liveMode: { live: { permissions: [{}], questions: [{}, {}], sessions: { a: { status: 'busy' }, b: { status: 'idle' }, c: {} } } } };
  assert.deepEqual(agentCounts(st), { needYou: 3, working: 1 });
});

test('the panel (Home 4.0.0): Needs you first, no greeting, no capture box, no copy of Docket\'s day', () => {
  const now = new Date(2026, 10, 4, 9);
  const html = render({ now, inbox: [{ app: 'receipts', appName: 'Rapport', title: '1:1 with <b>Dev</b>', note: '', route: '1on1s/p_a', flag: '' }], upcoming: [], week: [] });
  assert.match(html, /<div class="dash cols"><section class="card inbox">/);
  assert.match(html, /data-open="receipts" data-path="1on1s\/p_a"/);
  assert.ok(!html.includes('<b>Dev</b>'), 'escaped');
  assert.doesNotMatch(html, /Good morning|Morning,|yourday|Your day|Open Docket|data-edit-profile|Recent notes|id="capture"/);
  assert.match(render({ now, inbox: [], upcoming: [], week: [] }), /Nothing needs you right now/);
});

test('header: the date and one More menu with Weekly status; a labeled button on Friday afternoons', () => {
  const v = { now: new Date(2026, 10, 4, 9), inbox: [], upcoming: [], week: [] };
  const html = render(v);
  const tools = html.slice(html.indexOf('<div class="htools">'), html.indexOf('</header>'));
  assert.match(tools, /<details class="hmore"/);
  assert.match(tools, /class="mi" role="menuitem" data-status>/);
  assert.doesNotMatch(tools, /class="btn" data-status/);
  const fri = render({ ...v, now: new Date(2026, 10, 6, 14) });
  assert.match(fri.slice(0, fri.indexOf('</header>')), /class="btn" data-status>/);
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
