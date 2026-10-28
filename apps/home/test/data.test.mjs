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
function fakeWs({ backend = 'browser', embedded = true } = {}) {
  const handlers = {};
  const ws = {
    backend, embedded, allowed: false, gets: 0, puts: [],
    on(ev, fn) { (handlers[ev] ||= []).push(fn); return () => { handlers[ev] = handlers[ev].filter(f => f !== fn); }; },
    emit(ev, p) { for (const fn of handlers[ev] || []) fn(p); },
    data: {
      async get(c, o) {
        ws.gets++;
        if (!ws.allowed) throw unavailable();
        if (o && o.app === 'prioritizer') return c === 'tasks' ? tasksEnv : c === 'lists' ? listsEnv : null;
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
  assert.equal(ws.gets - before, 4, 'profile once, and tasks, lists and people once');
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
