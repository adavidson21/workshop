import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockingRows, heldInbox, render } from '../js/view.js';

const rows = [{ app: 'slate', appName: 'Slate', title: 'Decide on X', note: '', route: '', flag: '' }, { app: 'receipts', appName: 'Rapport', title: '1:1 due', note: '', route: '', flag: 'waiting' }];
const card = new Map([['blocking', { id: 'blocking', kind: 'list', title: 'PRs blocked on you', rows: [{ id: 't1', title: 'PR 12: Fix login', route: 'task/t1', flag: 'urgent' }] }]]);

test('Needs you outside a block, and with focus hours off: unchanged', () => {
  assert.deepEqual(heldInbox(rows, null), { rows, held: 0, until: '' });
  assert.deepEqual(heldInbox(rows, { state: 'off' }), { rows, held: 0, until: '' });
});

test('focus: only blocking PRs show, the rest is held until the span ends; lunch folds everything', () => {
  const blocking = blockingRows(card);
  assert.equal(blocking[0].title, 'PR 12: Fix login');
  assert.equal(blocking[0].route, 'task/t1');
  const f = heldInbox(rows, { state: 'focus', until: '12:00', span: { end: '13:00' } }, blocking);
  assert.deepEqual(f.rows, blocking); assert.equal(f.held, 2); assert.equal(f.until, '13:00');
  const l = heldInbox(rows, { state: 'lunch', until: '13:00', span: { end: '13:00' } }, blocking);
  assert.deepEqual(l.rows, []); assert.equal(l.held, 3);
  assert.deepEqual(blockingRows(null), []);
});

test('the page says how many are held and until when', () => {
  const v = { now: new Date(2026, 10, 9, 10), profile: {}, board: null, boardNote: 'x', inbox: rows, blocking: blockingRows(card), focus: { state: 'focus', until: '12:00', span: { end: '12:00' } }, agents: { state: 'off' } };
  const html = render(v);
  assert.match(html, /2 items held until 12:00/);
  assert.match(html, /PR 12: Fix login/);
  assert.doesNotMatch(html, /Decide on X/);
  const off = render(Object.assign({}, v, { focus: { state: 'off' } }));
  assert.match(off, /Decide on X/);
  assert.doesNotMatch(off, /held until/);
});
