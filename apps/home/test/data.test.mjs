// Home's loading with a fake SDK: waiting for folder access in browser mode, and the reload on Allow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHome } from '../js/data.js';
import { render } from '../js/view.js';
import { directory } from '../../../shared/people.js';

const unavailable = () => Object.assign(new Error('Allow Workshop to use the folder.'), { code: 'unavailable' });
// Docket's summary with today's board (2026-10-28): one open task.
const boardEnv = { schema: 'prioritizer.summary', version: 1, rev: 1, items: [
  { id: 'board', kind: 'board', updatedAt: 1, days: { '2026-10-28': { total: 1, open: 1, focus: { total: 0, done: 0 }, triage: 0, overdue: 0, dueWeek: 0 } },
    upNext: [{ id: 't1', title: 'Write the plan', list: '', listId: 'l1', due: null, who: [], triaged: true }], team: [] }] };
const dirEnv = { schema: 'settings.people', version: 2, rev: 1, items: [
  { id: 'p_j', kind: 'person', name: 'John Smith', handle: 'john', relation: 'peer' },
  { id: 'g_l', kind: 'group', name: 'Leadership', handle: 'leadership', members: ['p_j'] }] };
const profileEnv = { schema: 'home.profile', version: 1, rev: 2, items: [], deleted: {}, meta: { name: 'Sam Rivera', role: 'EM' } };

// A browser-backend SDK whose folder needs Allow until allow() is called.
function fakeWs({ backend = 'browser', embedded = true, summary = boardEnv } = {}) {
  const handlers = {};
  const ws = {
    backend, embedded, allowed: false, gets: 0, puts: [], read: [],
    on(ev, fn) { (handlers[ev] ||= []).push(fn); return () => { handlers[ev] = handlers[ev].filter(f => f !== fn); }; },
    emit(ev, p) { for (const fn of handlers[ev] || []) fn(p); },
    data: {
      async get(c, o) {
        ws.gets++;
        if (!ws.allowed) throw unavailable();
        if (o && o.app === 'prioritizer') { ws.read.push(c); return c === 'summary' ? summary : null; }
        return c === 'profile' ? profileEnv : null;
      },
      async put(c, env) { if (!ws.allowed) throw unavailable(); ws.puts.push([c, structuredClone(env)]); return { rev: env.rev + 1 }; }
    },
    people: {
      async get() { if (!ws.allowed) throw unavailable(); return directory(dirEnv); },
      subscribe() { return () => {}; }
    },
    connectors: { async list() { return []; } },
    allow() { ws.allowed = true; ws.emit('online', { online: true }); }
  };
  return ws;
}
const settle = () => new Promise(r => setTimeout(r, 0));

test('while the folder needs Allow, Home waits: a message pointing to the bar, no board, no profile button', async () => {
  const ws = fakeWs();
  const home = createHome(ws, { now: () => new Date(2026, 9, 28, 9) });
  await home.loadAll();
  assert.equal(home.waiting, true);
  assert.equal(home.v.board, null);
  const html = render(home.v);
  assert.match(html, /Allow Workshop to use your folder to see your day/);
  assert.match(html, /in the bar at the top of Workshop/);
  assert.ok(!html.includes('data-edit-profile'), 'no profile editing while waiting');
  assert.ok(!html.includes('No tasks yet') && !html.includes("Couldn't read your board"), 'not shown as an empty or broken board');
  const alone = render(Object.assign({}, home.v, { embedded: false }));
  assert.match(alone, /Open Workshop and click/);
  assert.match(alone, /data-open="home"/);
});

test('while waiting, nothing is saved, the profile included', async () => {
  const ws = fakeWs();
  const home = createHome(ws);
  await home.loadAll();
  await assert.rejects(home.saveProfile({ name: 'Typed while waiting', role: '' }), e => e.code === 'unavailable');
  ws.allowed = true; // even if the folder came back without an event, a waiting Home does not write
  await assert.rejects(home.saveProfile({ name: 'Typed while waiting', role: '' }), e => e.code === 'unavailable');
  assert.deepEqual(ws.puts, []);
});

test('on Allow (online turns true), profile, board and agents load again, once', async () => {
  const ws = fakeWs();
  let paints = 0;
  const home = createHome(ws, { onChange: () => paints++, now: () => new Date(2026, 9, 28, 9) });
  await home.loadAll();
  const before = ws.gets;
  ws.emit('online', { online: false });
  await settle();
  assert.equal(ws.gets, before, 'losing access does not reload');
  paints = 0;
  ws.allow();
  await settle(); await settle();
  assert.equal(home.waiting, false);
  assert.equal(ws.gets - before, 3, 'profile once, and Docket\'s and Notes\' summaries once each');
  assert.equal(home.v.board.open, 1);
  assert.deepEqual(home.v.profile, { name: 'Sam Rivera', role: 'EM' });
  assert.equal(home.v.agents.state, 'browser');
  assert.ok(paints > 0);
  const html = render(home.v);
  assert.match(html, /Morning, Sam/);
  assert.match(html, /1 open task/, 'the board loaded: the Today card counts it');
  assert.ok(!html.includes('Allow Workshop to use your folder'));
  // After the wait, the profile saves on top of the loaded revision.
  await home.saveProfile({ name: 'Sam R', role: 'EM' });
  assert.equal(ws.puts.length, 1);
  assert.equal(ws.puts[0][1].rev, 2);
});

test('a save that finds the folder gone starts waiting', async () => {
  const ws = fakeWs();
  ws.allowed = true;
  const home = createHome(ws);
  await home.loadAll();
  assert.equal(home.waiting, false);
  ws.allowed = false;
  await assert.rejects(home.saveProfile({ name: 'X', role: '' }), e => e.code === 'unavailable');
  assert.equal(home.waiting, true);
});

test('with the agent, an unavailable error is not a folder wait', async () => {
  const ws = fakeWs({ backend: 'agent' });
  const home = createHome(ws);
  await home.loadAll();
  assert.equal(home.waiting, false);
  assert.match(render(home.v), /read your board right now/);
});

import { captureContext } from '../js/capture.js';
test('captureContext: directory people and groups, and list names from summaries, all optional', () => {
  const dir = directory({ ...dirEnv, items: [...dirEnv.items, { id: 'p_2', kind: 'person', name: 'Gone', handle: 'gone', relation: 'peer', archived: true }] });
  const c = captureContext({ dir }, new Date('2026-11-03T12:00:00'));
  assert.equal(c.today, '2026-11-03');
  assert.deepEqual(c.people.map(p => p.id), ['p_j', 'g_l']);
  assert.deepEqual(c.lists, []);
  assert.deepEqual(captureContext().people, []);
  assert.deepEqual(captureContext().lists, []);
});

// Docket's summary (docs/summaries.md) for 2026-10-28, a Wednesday.
const summaryEnv = { schema: 'prioritizer.summary', version: 1, rev: 4, items: [
  { id: 'board', kind: 'board', updatedAt: 1, days: { '2026-10-28': { total: 5, open: 4, focus: { total: 2, done: 1 }, triage: 1, overdue: 0, dueWeek: 2, nudges: 3, cameBack: 1 } },
    upNext: [{ id: 't9', title: 'From the summary', list: '', listId: 'l1', due: null, who: ['g_l'], triaged: true }], team: [{ id: 'p_j', name: 'Old name', open: 2, waiting: 1 }] },
  { id: 'day', kind: 'day', updatedAt: 1, days: { '2026-10-28': { blocks: [
    { name: 'Deep work', at: '09:00', until: '11:00', tasks: [{ id: 't9', title: 'From the summary', done: false }] },
    { name: 'Meetings', at: '13:00', until: '14:00', tasks: [] }], wrapAt: '16:00', wrapped: false, offered: 2 } } }
] };

test('Docket\'s summary: the board and Wrap up come from it, with no reads of Docket\'s own collections', async () => {
  const ws = fakeWs({ summary: summaryEnv }); ws.allowed = true;
  const home = createHome(ws, { now: () => new Date(2026, 9, 28, 9, 30) });
  await home.loadBoard();
  assert.deepEqual(ws.read, ['summary']);
  assert.deepEqual(home.v.board.upNext[0].people, ['Leadership'], 'names for ids from the directory');
  assert.equal(home.v.board.team[0].name, 'John Smith');
  assert.equal(home.v.board.open, 4);
  assert.equal(home.v.board.upNext[0].title, 'From the summary');
  assert.deepEqual([home.v.board.nudges, home.v.board.cameBack], [3, 1], 'follow-ups due and came back');
  assert.deepEqual(home.v.wrap, { wrapped: false, due: false, receipts: 2 });
  const html = render(home.v);
  assert.match(html, /Open Today/);
  assert.ok(!html.includes('From the summary'), 'Up next is in Docket\'s Today, not on Home');
});

test('Docket\'s summary: a stale one (no entry for today) says to open Docket; none yet is an empty board', async () => {
  const ws = fakeWs({ summary: summaryEnv }); ws.allowed = true;
  const home = createHome(ws, { now: () => new Date(2026, 10, 9, 9) });
  await home.loadBoard();
  assert.deepEqual(ws.read, ['summary'], 'never Docket\'s own collections');
  assert.equal(home.v.board, null);
  assert.match(home.v.boardNote, /Open Docket/);
  const fresh = fakeWs({ summary: null }); fresh.allowed = true;
  const h2 = createHome(fresh, { now: () => new Date(2026, 10, 9, 9) });
  await h2.loadBoard();
  assert.equal(h2.v.board.total, 0);
  assert.match(render(h2.v), /Nothing from Docket yet/);
  const newer = fakeWs({ summary: { ...summaryEnv, version: 2 } }); newer.allowed = true;
  const h3 = createHome(newer, { now: () => new Date(2026, 9, 28, 9) });
  await h3.loadBoard();
  assert.match(h3.v.boardNote, /newer Docket/);
});

test('wrapFromDay: Wrap up time from the day card', async () => {
  const { wrapFromDay } = await import('../js/view.js');
  const day = summaryEnv.items[1].days['2026-10-28'];
  assert.deepEqual(wrapFromDay(day, 16 * 60), { wrapped: false, due: true, receipts: 2 });
  assert.deepEqual(wrapFromDay(Object.assign({}, day, { wrapAt: null }), 23 * 60), { wrapped: false, due: false, receipts: 2 }, 'a day off');
});

test('no Docket summary yet says to open Docket once, not "No tasks yet" or an error', async () => {
  const ws = fakeWs({ summary: null }); ws.allowed = true;
  const home = createHome(ws, { now: () => new Date(2026, 9, 28, 9) });
  await home.loadBoard();
  assert.equal(home.v.board.total, 0);
  assert.equal(home.v.noSummary, true);
  const html = render(home.v);
  assert.match(html, /Nothing from Docket yet/);
  assert.match(html, /Open Docket once/);
  assert.ok(!html.includes('No tasks yet'));
});

test('Recent notes: from Notes\' summary, titles only, opening each note; no card without one', async () => {
  const notesEnv = { schema: 'notes.summary', version: 1, rev: 1, items: [
    { id: 'recent', kind: 'list', updatedAt: 1, title: 'Recent notes', count: 2, rows: [{ id: 'a.md', title: 'Deploy <runbook>', route: 'runbooks/a.md' }, { id: 'b.md', title: 'Retro' }] }] };
  const ws = fakeWs();
  const get = ws.data.get;
  ws.data.get = async (c, o) => (o && o.app === 'notes' ? (ws.allowed ? (c === 'summary' ? notesEnv : null) : get(c, o)) : get(c, o));
  ws.allowed = true;
  const home = createHome(ws, { now: () => new Date(2026, 9, 28, 9) });
  await home.loadAll();
  assert.deepEqual(home.v.notes, [{ title: 'Deploy <runbook>', route: 'runbooks/a.md' }, { title: 'Retro', route: 'b.md' }]);
  const html = render(home.v);
  assert.match(html, /<h2>Recent notes<\/h2>/);
  assert.match(html, /data-open="notes" data-path="runbooks\/a\.md">Deploy &lt;runbook&gt;</);
  // Shown even when Docket has nothing to show yet.
  assert.match(render({ ...home.v, board: null, boardNote: 'Loading your board.' }), /Recent notes/);
  assert.match(render({ ...home.v, noSummary: true, summary: null }), /Recent notes/);
  const none = createHome(Object.assign(fakeWs(), { allowed: true }), { now: () => new Date(2026, 9, 28, 9) });
  await none.loadAll();
  assert.doesNotMatch(render(none.v), /Recent notes/);
});
