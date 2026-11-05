// Home's loading with a fake SDK: waiting for folder access in browser mode, and the reload on Allow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHome } from '../js/data.js';
import { render } from '../js/view.js';

const unavailable = () => Object.assign(new Error('Allow Workshop to use the folder.'), { code: 'unavailable' });
const tasksEnv = { schema: 'prioritizer.tasks', version: 3, rev: 1, items: [{ id: 't1', title: 'Write the plan', listId: 'l1', done: false, rank: 0, value: 3, effort: 'M' }] };
const listsEnv = { schema: 'prioritizer.lists', version: 1, rev: 1, items: [{ id: 'l1', name: 'Main' }] };
const profileEnv = { schema: 'home.profile', version: 1, rev: 2, items: [], deleted: {}, meta: { name: 'Sam Rivera', role: 'EM' } };

// A browser-backend SDK whose folder needs Allow until allow() is called.
function fakeWs({ backend = 'browser', embedded = true, summary = null } = {}) {
  const handlers = {};
  const ws = {
    backend, embedded, allowed: false, gets: 0, puts: [], read: [],
    on(ev, fn) { (handlers[ev] ||= []).push(fn); return () => { handlers[ev] = handlers[ev].filter(f => f !== fn); }; },
    emit(ev, p) { for (const fn of handlers[ev] || []) fn(p); },
    data: {
      async get(c, o) {
        ws.gets++;
        if (!ws.allowed) throw unavailable();
        if (o && o.app === 'prioritizer') { ws.read.push(c); return c === 'summary' ? summary : c === 'tasks' ? tasksEnv : c === 'lists' ? listsEnv : null; }
        return c === 'profile' ? profileEnv : null;
      },
      async put(c, env) { if (!ws.allowed) throw unavailable(); ws.puts.push([c, structuredClone(env)]); return { rev: env.rev + 1 }; }
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
  assert.equal(ws.gets - before, 10, 'profile once; Docket\'s summary once; with none, tasks, lists, people and the three day plan collections once; and Docket\'s focus log and offers once (Wrap up)');
  assert.equal(home.v.board.open, 1);
  assert.deepEqual(home.v.profile, { name: 'Sam Rivera', role: 'EM' });
  assert.equal(home.v.agents.state, 'browser');
  assert.ok(paints > 0);
  const html = render(home.v);
  assert.match(html, /Good morning, Sam/);
  assert.match(html, /Write the plan/);
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
test('captureContext: directory people and Docket list names, both optional', () => {
  const people = { schema: 'settings.people', version: 1, items: [{ id: 'p_1', name: 'Person One', relation: 'report' }, { id: 'p_2', name: 'Gone', relation: 'peer', archived: true }] };
  const lists = { schema: 'prioritizer.lists', version: 1, items: [{ id: 'l1', name: 'Inbox' }, { id: 'l2', name: 'Old', archived: true }] };
  const c = captureContext({ people, lists }, new Date('2026-11-03T12:00:00'));
  assert.equal(c.today, '2026-11-03');
  assert.deepEqual(c.people, [{ id: 'p_1', name: 'Person One', relation: 'report' }]);
  assert.deepEqual(c.lists, ['Inbox']);
  assert.deepEqual(captureContext({ people: { schema: 'settings.people', version: 2, items: [{ id: 'p', name: 'x' }] } }).people, [], 'an unknown version reads as none');
  assert.deepEqual(captureContext().lists, []);
});

// Docket's summary (docs/summaries.md) for 2026-10-28, a Wednesday.
const summaryEnv = { schema: 'prioritizer.summary', version: 1, rev: 4, items: [
  { id: 'board', kind: 'board', updatedAt: 1, days: { '2026-10-28': { total: 5, open: 4, focus: { total: 2, done: 1 }, triage: 1, overdue: 0, dueWeek: 2 } },
    upNext: [{ id: 't9', title: 'From the summary', list: '', listId: 'l1', due: null, people: [], triaged: true }], team: [] },
  { id: 'day', kind: 'day', updatedAt: 1, days: { '2026-10-28': { blocks: [
    { name: 'Deep work', at: '09:00', until: '11:00', tasks: [{ id: 't9', title: 'From the summary', done: false }] },
    { name: 'Meetings', at: '13:00', until: '14:00', tasks: [] }], wrapAt: '16:00', wrapped: false, offered: 2 } } }
] };

test('Docket\'s summary: the board, Now and Wrap up come from it, with no reads of Docket\'s own collections', async () => {
  const ws = fakeWs({ summary: summaryEnv }); ws.allowed = true;
  const home = createHome(ws, { now: () => new Date(2026, 9, 28, 9, 30) });
  await home.loadBoard();
  assert.deepEqual(ws.read, ['summary']);
  assert.equal(home.v.source, 'summary');
  assert.equal(home.v.board.open, 4);
  assert.equal(home.v.board.upNext[0].title, 'From the summary');
  assert.equal(home.v.dayNow.current.name, 'Deep work');
  assert.equal(home.v.dayNow.current.until, '11:00');
  assert.equal(home.v.dayNow.next.name, 'Meetings');
  assert.deepEqual(home.v.wrap, { wrapped: false, due: false, receipts: 2 });
  assert.match(render(home.v), /From the summary/);
});

test('Docket\'s summary: a stale one (no entry for today) falls back to Docket\'s collections', async () => {
  const ws = fakeWs({ summary: summaryEnv }); ws.allowed = true;
  const home = createHome(ws, { now: () => new Date(2026, 10, 9, 9) });
  await home.loadBoard();
  assert.equal(home.v.source, 'collections');
  assert.ok(ws.read.includes('tasks'));
  assert.equal(home.v.board.open, 1);
});

test('nowFromDay and wrapFromDay: between blocks, after the last one, and Wrap up time', async () => {
  const { nowFromDay, wrapFromDay } = await import('../js/view.js');
  const day = summaryEnv.items[1].days['2026-10-28'];
  assert.equal(nowFromDay(day, 12 * 60).current, null);
  assert.equal(nowFromDay(day, 12 * 60).next.name, 'Meetings');
  assert.equal(nowFromDay(day, 15 * 60), null);
  assert.equal(nowFromDay({ blocks: [] }, 600), null);
  assert.deepEqual(wrapFromDay(day, 16 * 60), { wrapped: false, due: true, receipts: 2 });
  assert.deepEqual(wrapFromDay(Object.assign({}, day, { wrapAt: null }), 23 * 60), { wrapped: false, due: false, receipts: 2 }, 'a day off');
});
