// shared/pair.js: pairing a site with Workshop on this computer (docs/run-modes.md, Pairing).
import { test } from 'node:test';
import assert from 'node:assert/strict';

// A minimal window: location, localStorage, window.open and message events.
function fakeWindow(protocol = 'https:') {
  const listeners = new Set();
  const store = new Map();
  const opened = [];
  let reloaded = 0;
  globalThis.location = { protocol, origin: `${protocol}//docket.example.org`, reload: () => { reloaded++; } };
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  globalThis.window = {
    open: (url, name, features) => { const w = { url }; opened.push(w); return w; },
    addEventListener: (t, fn) => { if (t === 'message') listeners.add(fn); },
    removeEventListener: (t, fn) => listeners.delete(fn)
  };
  const post = (source, origin, data) => [...listeners].forEach(fn => fn({ source, origin, data }));
  return { store, opened, post, reloads: () => reloaded, listeners };
}

const load = async () => import(`../pair.js?${Math.random()}`);

test('canPair: only an unpaired site on https', async () => {
  fakeWindow('https:');
  const { canPair, isPaired } = await load();
  assert.equal(canPair({ mode: 'browser', storage: 'indexeddb' }), true);
  assert.equal(canPair({ mode: 'browser', storage: 'folder' }), true);
  assert.equal(canPair({ mode: 'hosted', storage: 'agent' }), false);
  assert.equal(canPair(null), false);
  assert.equal(isPaired({ mode: 'hosted' }), true);
  fakeWindow('http:');
  assert.equal((await load()).canPair({ mode: 'browser', storage: 'indexeddb' }), false);
});

test('pairWith opens the agent\'s pairing window for this site', async () => {
  const w = fakeWindow();
  const { pairWith } = await load();
  assert.equal(pairWith(4380), 'opened');
  assert.equal(w.opened[0].url, 'http://127.0.0.1:4380/pair?origin=https%3A%2F%2Fdocket.example.org');
  assert.throws(() => pairWith(80), RangeError);
});

test('the pair is saved and the page reloads only for a real answer from that window', async () => {
  const w = fakeWindow();
  const { pairWith, PAIR_KEY } = await load();
  pairWith(4380);
  const win = w.opened[0];
  const good = { type: 'workshop-pair', api: 1, url: 'http://127.0.0.1:4380', token: 't0k' };
  w.post({}, 'http://127.0.0.1:4380', good);                                   // another window
  w.post(win, 'https://evil.example', good);                                 // not the agent
  w.post(win, 'http://127.0.0.1:4380', { ...good, url: 'http://127.0.0.1:9' }); // url is not the sender
  w.post(win, 'http://127.0.0.1:4380', { ...good, token: '' });
  w.post(win, 'http://127.0.0.1:4380', { ...good, api: 2 });
  assert.equal(w.store.get(PAIR_KEY), undefined);
  assert.equal(w.reloads(), 0);
  w.post(win, 'http://127.0.0.1:4380', good);
  assert.deepEqual(JSON.parse(w.store.get(PAIR_KEY)), { url: 'http://127.0.0.1:4380', token: 't0k' });
  assert.equal(w.reloads(), 1);
  assert.equal(w.listeners.size, 0, 'stops listening once paired');
});

test('a blocked window, and forgetting the pair', async () => {
  const w = fakeWindow();
  const { pairWith, forgetPairing, PAIR_KEY } = await load();
  globalThis.window.open = () => null;
  assert.equal(pairWith(4380), 'blocked');
  w.store.set(PAIR_KEY, '{}');
  forgetPairing();
  assert.equal(w.store.has(PAIR_KEY), false);
  assert.equal(w.reloads(), 1);
});
