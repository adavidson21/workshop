// Chat 4.6.0: actions on one message (Copy, Undo from here, Fork from here) and /copy. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { richRows, transcript, turnText } from '../js/parts.js';

const TURNS = [
  { id: 'msg_1', role: 'you', text: 'one' },
  { id: 'msg_2', role: 'tandem', text: 'first step' },
  { id: 'msg_3', role: 'tandem', text: 'answer a' },
  { id: 'msg_4', role: 'you', text: 'two <b>' },
  { id: 'msg_5', role: 'tandem', text: 'answer b' },
];

test('Copy takes your message, or a whole answer up to your next message', () => {
  assert.equal(turnText(TURNS, 'msg_1'), 'one');
  assert.equal(turnText(TURNS, 'msg_3'), 'first step\n\nanswer a');
  assert.equal(turnText(TURNS, 'msg_5'), 'answer b');
  assert.equal(turnText(TURNS, 'nope'), '');
});

test('/copy is the whole chat as Markdown', () => {
  assert.equal(transcript(TURNS.slice(0, 2), 'Sample'), '# Sample\n\n**You:** one\n\n**opencode:** first step');
});

test('each message gets its actions only when asked; undo and fork wait until opencode is idle', () => {
  assert.doesNotMatch(richRows(TURNS), /turn-acts/, 'side chats and the hub draw none');
  const html = richRows(TURNS, { actions: true });
  assert.match(html, /data-turn-undo="msg_1"/);
  assert.match(html, /data-turn-fork="msg_3"/, 'Fork from here names the last message of the answer');
  assert.equal((html.match(/data-turn-copy=/g) || []).length, 4);
  const busy = richRows(TURNS, { actions: true, busy: true });
  assert.doesNotMatch(busy, /data-turn-undo|data-turn-fork/);
  assert.match(busy, /data-turn-copy="msg_5"/);
  assert.doesNotMatch(richRows([{ id: '', role: 'you', text: 'sending' }], { actions: true }), /turn-acts/, 'a message on its way has no id yet');
});
