// live.js (Chat 4.5.0): streamed text in the turns Chat last read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruneLive, withLive } from '../js/live.js';
import { isQuestion } from '../js/hub.js';

const you = { id: 'm1', role: 'you', text: 'Why?', parts: [] };

test('a part opencode already listed takes the longer streamed text', () => {
  const turns = [you, { id: 'm2', role: 'tandem', parts: [{ type: 'text', id: 'p1', text: 'Be' }] }];
  const out = withLive(turns, new Map([['p1', 'Because']]), true);
  assert.equal(out[1].parts[0].text, 'Because');
  assert.equal(turns[1].parts[0].text, 'Be', 'the read is not changed');
  assert.equal(withLive(turns, new Map([['p1', 'B']]), true)[1].parts[0].text, 'Be', 'never shorter');
});

test('a part not listed yet is a new answer after your message, or goes at the end of the last answer', () => {
  const a = withLive([you], new Map([['p9', 'Hello']]), true);
  assert.equal(a.length, 2);
  assert.deepEqual(a[1].parts, [{ type: 'text', id: 'p9', text: 'Hello' }]);
  const b = withLive([you, { id: 'm2', role: 'tandem', parts: [{ type: 'tool', tool: 'read' }] }], new Map([['p9', 'Done']]), true);
  assert.equal(b.length, 2);
  assert.equal(b[1].parts[1].text, 'Done');
  assert.equal(withLive([you], new Map([['p9', 'Hello']]), false).length, 1, 'not once opencode is idle');
});

test('pruneLive drops what a read has in full, and everything when idle', () => {
  const live = new Map([['p1', 'Because'], ['p2', 'More']]);
  const turns = [you, { role: 'tandem', parts: [{ type: 'text', id: 'p1', text: 'Because' }] }];
  assert.deepEqual([...pruneLive(live, turns, true)], [['p2', 'More']]);
  assert.equal(pruneLive(live, turns, false), null);
});

test('isQuestion: questions get a quick answer; captures do not', () => {
  for (const q of ['When do we release?', 'how do I run the gateway', 'Who owns billing', 'explain the retry logic']) assert.equal(isQuestion(q), true, q);
  for (const c of ['task call the vendor Tuesday', 'n standup notes', 'b fix the login timeout', 'r lunch 12.50']) assert.equal(isQuestion(c), false, c);
});
