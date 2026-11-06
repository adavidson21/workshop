// Slate's Roadmap tab: the stand-in shell for Runway's frame (js/host.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import { hostFrame } from '../js/host.js';

function setup() {
  const listeners = [];
  const sent = [];
  const child = { postMessage: (m) => sent.push(m) };
  const frame = { contentWindow: child };
  const win = { location: { origin: 'https://w' }, addEventListener: (t, f) => listeners.push(f), removeEventListener: () => { listeners.length = 0; } };
  const calls = [];
  const themeHandlers = [];
  const ws = {
    theme: { current: () => ({ key: 'light', scheme: 'light' }) },
    open: async (t) => { calls.push(['open', t]); return null; },
    toast: async (text, o) => { calls.push(['toast', text, o.kind]); return null; },
    notify: async (p) => { calls.push(['notify', p.title]); return null; },
    on: (ev, fn) => { themeHandlers.push(fn); return () => {}; }
  };
  const opened = [];
  const host = hostFrame(frame, { ws, win, onOpenSlate: (p) => opened.push(p), getRoute: () => 'm_1' });
  const post = (m, source = child, origin = 'https://w') => listeners.forEach(f => f({ origin, source, data: { workshop: 1, kind: 'request', ...m } }));
  const tick = () => new Promise(r => setTimeout(r, 5));
  return { host, sent, calls, opened, post, tick, themeHandlers };
}

test('answers ready like the shell, with the route Slate wants', async () => {
  const t = setup();
  t.post({ id: 'r1', method: 'ready', params: { app: 'runway', sdk: 1 } });
  await t.tick();
  assert.deepEqual(t.sent[0], { workshop: 1, kind: 'response', id: 'r1', ok: true, result: { theme: { key: 'light', scheme: 'light' }, route: 'm_1', visible: true } });
  t.post({ id: 'r2', method: 'ready', params: { app: 'notes' } });
  await t.tick();
  assert.equal(t.sent[1].ok, false);
  assert.equal(t.sent[1].error.code, 'bad_request');
});

test('open: its own routes stay in the frame, slate opens an item, other apps go to the shell', async () => {
  const t = setup();
  t.post({ id: 'r1', method: 'ready', params: { app: 'runway' } });
  t.post({ id: 'r2', method: 'open', params: { app: 'runway', path: 'm_2' } });
  t.post({ id: 'r3', method: 'open', params: { app: 'slate', path: 'runway/m_2/i_9' } });
  t.post({ id: 'r4', method: 'open', params: { app: 'agents', path: '41207' } });
  t.post({ id: 'r5', method: 'toast', params: { text: 'Saved', kind: 'success' } });
  t.post({ id: 'r6', method: 'badge', params: { count: 3 } });
  t.post({ id: 'r7', method: 'frobnicate', params: {} });
  await t.tick();
  assert.ok(t.sent.some(m => m.kind === 'event' && m.event === 'route' && m.payload.path === 'm_2'));
  assert.deepEqual(t.opened, ['runway/m_2/i_9']);
  assert.deepEqual(t.calls, [['open', { app: 'agents', path: '41207' }], ['toast', 'Saved', 'success']]);
  const r7 = t.sent.find(m => m.id === 'r7');
  assert.equal(r7.error.code, 'not_found');
  assert.equal(t.sent.find(m => m.id === 'r6').ok, true);
});

test('ignores other frames and origins, and passes theme changes on once ready', async () => {
  const t = setup();
  t.post({ id: 'x', method: 'ready', params: { app: 'runway' } }, { postMessage() {} });
  t.post({ id: 'y', method: 'ready', params: { app: 'runway' } }, undefined, 'https://evil');
  await t.tick();
  assert.equal(t.sent.length, 0);
  t.themeHandlers.forEach(f => f({ key: 'dark', scheme: 'dark' }));
  assert.equal(t.sent.length, 0, 'no events before ready');
  t.post({ id: 'r1', method: 'ready', params: { app: 'runway' } });
  await t.tick();
  t.themeHandlers.forEach(f => f({ key: 'dark', scheme: 'dark' }));
  assert.deepEqual(t.sent.at(-1), { workshop: 1, kind: 'event', event: 'theme', payload: { key: 'dark', scheme: 'dark' } });
});
