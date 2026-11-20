// Tests for Chat's pictures (js/images.js) and the workbench's width (js/bench.js): the parts with no DOM. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUDGET, EACH, MAX, chipsHtml, nameFor, picturesIn, roomFor } from '../js/images.js';
import { MAX_W, MIN_W, TABS, clampWidth } from '../js/bench.js';

const pic = n => ({ id: 'p' + n, name: `p${n}.png`, mime: 'image/png', data: 'A'.repeat(n), url: '' });

test('room for the next picture: each takes at most EACH, all of them BUDGET, and MAX pictures', () => {
  assert.equal(roomFor([]), EACH);
  assert.equal(roomFor([pic(500000)]), BUDGET - 500000);
  assert.equal(roomFor([pic(BUDGET - 30000)]), 0, 'too little left to be worth a picture');
  assert.equal(roomFor(Array.from({ length: MAX }, () => pic(10))), 0);
  assert.ok(BUDGET < 920000, 'under what the connector takes');
});

test('names keep the picture recognizable and match the type it is sent as', () => {
  assert.equal(nameFor('Screen Shot 2026-11-19 at 4.12.03 PM.png', 'image/jpeg'), 'Screen Shot 2026-11-19 at 4.12.03 PM.jpg');
  assert.equal(nameFor('', 'image/png'), 'pasted.png');
  assert.equal(nameFor('<img src=x>.gif', 'image/gif'), 'img srcx.gif');
});

test('a paste that carries text is text; image files come from files or items', () => {
  const png = { type: 'image/png', name: 'a.png' }, txt = { type: 'text/plain', name: 'a.txt' };
  assert.deepEqual(picturesIn({ files: [png, txt], getData: () => '' }, { paste: true }), [png]);
  assert.deepEqual(picturesIn({ files: [png], getData: () => 'copied words' }, { paste: true }), []);
  assert.deepEqual(picturesIn({ files: [], items: [{ kind: 'file', type: 'image/webp', getAsFile: () => png }] }), [png]);
  assert.deepEqual(picturesIn(null), []);
});

test('chips carry no picture data, only an id the page fills in', () => {
  const html = chipsHtml([{ ...pic(3), name: 'a"b.png', url: 'data:image/png;base64,AAAA' }], 'data-pic-x');
  assert.match(html, /<img alt="a&quot;b\.png" data-img-local="p3">/);
  assert.match(html, /data-pic-x="p3"/);
  assert.doesNotMatch(html, /base64/);
  assert.equal(chipsHtml([], 'x'), '');
});

test('the workbench: three tabs, and a width that leaves the chat room', () => {
  assert.deepEqual(TABS.map(t => t.id), ['terminal', 'files', 'side']);
  assert.equal(clampWidth(100), MIN_W);
  assert.equal(clampWidth(5000), MAX_W);
  assert.equal(clampWidth(900, 1100), 740, 'at least 360 pixels stay for the chat');
  assert.equal(clampWidth('nope'), 520);
});
