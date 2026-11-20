// Chat 4.1.0: the Changes view's diff rows and the one message its comments go back in. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentMessage, diffRows } from '../js/changes.js';
import { MAX_DOC, PIECE, nameForDoc } from '../js/images.js';
import { TABS } from '../js/bench.js';

test('diff rows carry old and new line numbers, so a comment names the right line', () => {
  const rows = diffRows('@@ -10,4 +10,5 @@ class Headers\n keep\n-old line\n+new line\n+added\n tail\n\\ No newline at end of file');
  assert.deepEqual(rows.map(r => [r.kind, r.old, r.new, r.text]), [
    ['hunk', null, null, '@@ -10,4 +10,5 @@ class Headers'],
    ['ctx', 10, 10, 'keep'],
    ['del', 11, null, 'old line'],
    ['add', null, 11, 'new line'],
    ['add', null, 12, 'added'],
    ['ctx', 12, 13, 'tail'],
    ['note', null, null, 'No newline at end of file'],
  ]);
  assert.deepEqual(diffRows(''), []);
  assert.deepEqual(diffRows('@@ -0,0 +1,2 @@\n+a\n+b').map(r => r.new), [null, 1, 2]);
});

test('every comment goes back to the chat in one message, with its file, line and the line itself', () => {
  const text = commentMessage([
    { path: 'gateway/src/headers.cs', line: 12, side: 'new', quote: '  var limit = 100;', body: 'Read the limit from options.' },
    { path: 'gateway/src/old.cs', line: 3, side: 'old', quote: 'return null;', body: 'Keep this guard.\nAC-2 needs it.' },
  ]);
  assert.equal(text, [
    'Please address these 2 comments on your changes:',
    '',
    '1. `gateway/src/headers.cs:12`',
    '   > var limit = 100;',
    '   Read the limit from options.',
    '',
    '2. `gateway/src/old.cs:3` (a removed line)',
    '   > return null;',
    '   Keep this guard.',
    '   AC-2 needs it.',
  ].join('\n'));
  assert.match(commentMessage([{ path: 'a', line: 1, side: 'new', quote: '', body: 'x' }]), /^Please address this comment/);
});

test('PDFs go up in whole base64 pieces, 20 MB at most; the workbench has Changes and a Second chat', () => {
  assert.equal(PIECE % 3, 0, 'pieces join cleanly');
  assert.ok((PIECE / 3) * 4 <= 700000, 'a piece fits the connector');
  assert.equal(MAX_DOC, 20 * 1024 * 1024);
  assert.equal(nameForDoc('Q3 plan (final)?.pdf'), 'Q3 plan (final).pdf');
  assert.deepEqual(TABS.map(t => t.id), ['terminal', 'files', 'changes', 'side', 'split']);
});
