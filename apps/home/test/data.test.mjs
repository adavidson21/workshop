// The Needs you panel's loading with a fake SDK: waiting for folder access in browser mode, the reload on Allow,
// and Docket read only through its summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHome } from '../js/data.js';
import { render } from '../js/view.js';
import { directory } from '../../../shared/people.js';

const unavailable = () => Object.assign(new Error('Allow Workshop to use the folder.'), { code: 'unavailable' });
// Docket's summary with today's board (2026-10-28): one open task, and a needs card.
const boardEnv = { schema: 'prioritizer.summary', version: 1, rev: 1, items: [
  { id: 'board', kind: 'board', updatedAt: 1, days: { '2026-10-28': { total: 1, open: 1, focus: { total: 0, done: 0 }, triage: 0, overdue: 0, dueWeek: 0 } },
    upNext: [{ id: 't1', title: 'Write the plan', list: '', listId: 'l1', due: null, who: [], triaged: true }], team: [] },
  { id: 'needs', kind: 'list', updatedAt: 1, title: 'Needs you', count: 1, rows: [{ id: 'nudges', title: '1 follow-up due', note: 'Nudge, or take it back', route: 'today', flag: 'waiting' }] }] };
const dirEnv = { schema: 'settings.people', version: 2, rev: 1, items: [{ id: 'p_j', kind: 'person', name: 'John Smith', handle: 'john', relation: 'peer' }] };
const profileEnv = { schema: 'home.profile', version: 1, rev: 2, items: [], deleted: {}, meta: { name: 'Sam Rivera', role: 'EM' } };

// A browser-backend SDK whose folder needs Allow until allow() is called.
function fakeWs({ backend = 'browser', embedded = true, summary = boardEnv } = {}) {
  const handlers = {};
  const ws = {
    backend, embedded, allowed: false, gets: 0, puts: [], read: [],
    on(ev, fn) { (handlers[ev] ||= []).push(fn); return () => { handlers[ev] = handlers[ev].filter(f => f !== fn); }; },
    emit(ev, p) { for (const fn of handlers[ev] || []) fn(p); },
    apps: { async list() { return [{ id: 'home', name: 'Needs you' }, { id: 'prioritizer', name: 'Docket' }]; } },
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

test('while the folder needs Allow, the panel waits: a message pointing to the bar, and nothing else', async () => {
  const ws = fakeWs();
  const home = createHome(ws, { now: () => new Date(2026, 9, 28, 9) });
  await home.loadAll();
  assert.equal(home.waiting, true);
  assert.equal(home.v.board, null);
  const html = render(home.v);
  assert.match(html, /Allow Workshop to use your folder to see your day/);
  assert.match(html, /in the bar at the top of Workshop/);
  assert.ok(!html.includes('Needs you</h2>'), 'no empty Needs you while waiting');
  const alone = render(Object.assign({}, home.v, { embedded: false }));
  assert.match(alone, /Open Workshop and click/);
  assert.match(alone, /data-open="home"/);
  assert.deepEqual(ws.puts, [], 'nothing is saved');
});

test('on Allow (online turns true), profile, board, agents and Needs you load again, once', async () => {
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
  await settle(); await settle(); await settle();
  assert.equal(home.waiting, false);
  assert.equal(home.v.board.total, 1);
  assert.deepEqual(home.v.profile, { name: 'Sam Rivera', role: 'EM' });
  assert.equal(home.v.agents.state, 'browser');
  assert.ok(paints > 0);
  const html = render(home.v);
  assert.match(html, /1 follow-up due/, 'Docket\'s needs row');
  assert.ok(!html.includes('Allow Workshop to use your folder'));
});

test('with the agent, an unavailable error is not a folder wait', async () => {
  const ws = fakeWs({ backend: 'agent' });
  const home = createHome(ws);
  await home.loadAll();
  assert.equal(home.waiting, false);
  assert.match(render(home.v), /Nothing needs you right now/);
});

test('Docket is read only through its summary: tasks for Get started, none yet is an empty board, stale is unknown', async () => {
  const ws = fakeWs(); ws.allowed = true;
  const home = createHome(ws, { now: () => new Date(2026, 9, 28, 9, 30) });
  await home.loadBoard();
  assert.deepEqual(ws.read, ['summary'], 'never Docket\'s own collections');
  assert.deepEqual(home.v.board, { total: 1 });
  const stale = createHome(Object.assign(fakeWs(), { allowed: true }), { now: () => new Date(2026, 10, 9, 9) });
  await stale.loadBoard();
  assert.equal(stale.v.board, null);
  const fresh = fakeWs({ summary: null }); fresh.allowed = true;
  const h2 = createHome(fresh, { now: () => new Date(2026, 10, 9, 9) });
  await h2.loadBoard();
  assert.deepEqual(h2.v.board, { total: 0 });
});
