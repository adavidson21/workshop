// Chat 4.2.0: several chats at once (alerts.js) and Review code's messages (changes.js). Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALERTS_KEY, alertText, alertsState, chatEvents, chatKey, nextNeedy, stepChat } from '../js/alerts.js';
import { findingCounts, fixMessage } from '../js/changes.js';

test('chatEvents: done when a turn ends, needs when it starts waiting; nothing on the first read or for outside sessions', () => {
  const a = { session: 'a', title: 'Fix headers', busy: true };
  const b = { session: 'b', title: 'Docs', busy: false };
  const run = { session: 'r', title: 'Tandem run', busy: true, from: 'opencode' };
  let r = chatEvents(null, [a, b, run]);
  assert.deepEqual(r.events, []);
  assert.deepEqual(Object.keys(r.next), ['a', 'b']);
  r = chatEvents(r.next, [{ ...a, busy: false }, { ...b, waiting: true }, { ...run, busy: false }]);
  assert.deepEqual(r.events, [{ kind: 'done', session: 'a', title: 'Fix headers' }, { kind: 'needs', session: 'b', title: 'Docs' }]);
  r = chatEvents(r.next, [{ ...a, busy: false }, { ...b, waiting: true }]);
  assert.deepEqual(r.events, [], 'no repeats');
  r = chatEvents(r.next, [{ ...a, busy: true }]);
  r = chatEvents(r.next, [{ ...a, busy: false, waiting: true }]);
  assert.deepEqual(r.events.map(e => e.kind), ['needs'], 'a turn that ends on a question is "needs", not "done"');
  r = chatEvents(r.next, [{ session: 'n', title: '', busy: true }]);
  r = chatEvents(r.next, [{ session: 'n', busy: false }]);
  assert.deepEqual(r.events, [{ kind: 'done', session: 'n', title: 'Chat' }]);
  assert.deepEqual(alertText({ kind: 'needs', title: 'Docs' }).title, 'Docs needs you');
  assert.deepEqual(alertText({ kind: 'done', title: 'Docs' }).title, 'Docs is done');
});

test('stepChat and nextNeedy: wrap around the list; nextNeedy skips chats that do not need you', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.equal(stepChat(order, 'b', 1), 'c');
  assert.equal(stepChat(order, 'd', 1), 'a');
  assert.equal(stepChat(order, 'a', -1), 'd');
  assert.equal(stepChat(order, null, 1), 'a');
  assert.equal(stepChat(order, null, -1), 'd');
  assert.equal(stepChat([], 'a', 1), null);
  const needs = s => s === 'a' || s === 'c';
  assert.equal(nextNeedy(order, 'a', needs), 'c');
  assert.equal(nextNeedy(order, 'c', needs), 'a');
  assert.equal(nextNeedy(order, 'd', needs), 'a');
  assert.equal(nextNeedy(order, null, needs), 'a');
  assert.equal(nextNeedy(order, 'b', () => false), null);
});

test('chatKey: Alt alone with N, J, Up and Down; anything else is not Chat\'s', () => {
  const k = (code, key, mods = {}) => chatKey({ code, key, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });
  assert.equal(k('KeyN', 'n'), 'new');
  assert.equal(k('KeyN', '˜'), 'new', 'macOS Option+N types a dead key; the code still says N');
  assert.equal(k('KeyJ', 'j'), 'jump');
  assert.equal(k('ArrowUp', 'ArrowUp'), 'prev');
  assert.equal(k('ArrowDown', 'ArrowDown'), 'next');
  assert.equal(k('KeyN', 'n', { ctrlKey: true }), null);
  assert.equal(k('KeyN', 'N', { shiftKey: true }), null);
  assert.equal(k('KeyN', 'n', { altKey: false }), null);
  assert.equal(k('ArrowLeft', 'ArrowLeft'), null, 'Alt+Left is the browser\'s Back');
});

test('alertsState: on only when not turned off and the browser allows it', () => {
  const store = v => ({ getItem: k => (k === ALERTS_KEY ? v : null) });
  const N = perm => Object.assign(function () {}, { permission: perm });
  assert.deepEqual(alertsState(store(null), N('granted')), { off: false, perm: 'granted', on: true });
  assert.deepEqual(alertsState(store('off'), N('granted')), { off: true, perm: 'granted', on: false });
  assert.equal(alertsState(store(null), N('default')).on, false);
  assert.equal(alertsState(store(null), N('denied')).on, false);
  assert.equal(alertsState(store(null), null).perm, 'unsupported');
  assert.equal(alertsState({ getItem() { throw new Error('blocked'); } }, N('granted')).on, true);
});

test('Review code: Fix this and Fix all send one message naming each finding; counts read by severity', () => {
  const f = [
    { id: 'f1', severity: 'blocker', path: 'api/auth.cs', line: 42, text: 'The token is logged.' },
    { id: 'f2', severity: 'nit', path: 'README.md', line: null, text: 'Typo.\nSecond line.' }
  ];
  assert.equal(fixMessage(f.slice(0, 1)), 'Please fix this finding from a code review of your changes:\n\n1. Blocker: `api/auth.cs:42`\n   The token is logged.\n\nFix what you agree with. For anything you think is wrong, say why instead of changing it.');
  const m = fixMessage(f);
  assert.match(m, /^Please fix these 2 findings/);
  assert.match(m, /2\. Nit: `README\.md`\n   Typo\.\n   Second line\./);
  assert.equal(findingCounts(f), '1 blocker, 1 nit');
  assert.equal(findingCounts([...f, { severity: 'should-fix' }, { severity: 'should-fix' }, { severity: 'nit' }]), '1 blocker, 2 should fix, 2 nits');
  assert.equal(findingCounts([]), '');
});
