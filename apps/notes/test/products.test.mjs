import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baselineFor, blocksToMark, changedLines, isProductPath, isoNow, markReviewed, needsReview, productNotes, setField,
  timeOf, toReview
} from '../js/products.js';
import { buildIndex, search } from '../js/model.js';
import { facts, frontmatter } from '../js/markdown.js';
import { STARTERS, fill, missingStarters } from '../js/templates.js';
import { notesCards } from '../js/summary-cards.js';

const note = (fm, body = '# Wiki Edge\n\n## Remembered\n\n- one\n') => `---\n${fm}\n---\n${body}`;

test('product paths are notes directly in products/', () => {
  assert.equal(isProductPath('products/wiki-edge.md'), true);
  assert.equal(isProductPath('products/a/b.md'), false);
  assert.equal(isProductPath('runbooks/wiki-edge.md'), false);
  assert.equal(isProductPath('products/Wiki.md'), false);
});

test('review fields: times, plain dates, and junk', () => {
  assert.equal(timeOf('2026-11-05'), Date.UTC(2026, 10, 5));
  assert.equal(timeOf('2026-11-05T22:14:00Z'), Date.UTC(2026, 10, 5, 22, 14));
  assert.equal(timeOf(''), null);
  assert.equal(timeOf('yesterday'), null);
  const f = frontmatter(note('reviewed: 2026-11-01\ntandem-changed: "2026-11-05T10:00:00Z"')).data;
  assert.equal(f.reviewed, '2026-11-01');
  assert.equal(f.tandemChanged, '2026-11-05T10:00:00Z');
  assert.deepEqual(facts(note('title: X')).review, { reviewed: '', tandemChanged: '' });
});

test('needs review while Tandem changed it after the last review', () => {
  assert.equal(needsReview({ tandemChanged: '2026-11-05T10:00:00Z', reviewed: '' }), true);
  assert.equal(needsReview({ tandemChanged: '2026-11-05T10:00:00Z', reviewed: '2026-11-05T09:00:00Z' }), true);
  assert.equal(needsReview({ tandemChanged: '2026-11-05T10:00:00Z', reviewed: '2026-11-05T10:00:00Z' }), false);
  assert.equal(needsReview({ tandemChanged: '', reviewed: '' }), false);
  assert.equal(needsReview(undefined), false);
});

test('setField and markReviewed keep the rest of the note', () => {
  const t = note('title: X\ntags: [product]');
  const r = markReviewed(t, Date.UTC(2026, 10, 5, 22, 14, 3, 900));
  assert.match(r, /^---\ntitle: X\ntags: \[product\]\nreviewed: 2026-11-05T22:14:03Z\n---\n# Wiki Edge/);
  assert.equal(setField(r, 'reviewed', '2026-11-06'), r.replace('2026-11-05T22:14:03Z', '2026-11-06'));
  assert.equal(setField('# Plain\n', 'reviewed', 'x'), '---\nreviewed: x\n---\n# Plain\n');
  assert.match(setField('---\r\ntitle: X\r\n---\r\nbody', 'tandem-changed', 'y'), /^---\r\ntitle: X\r\ntandem-changed: y\r\n---\r\nbody$/);
  assert.equal(isoNow(Date.UTC(2026, 0, 2, 3, 4, 5, 600)), '2026-01-02T03:04:05Z');
});

test('the baseline is the first version kept after the last review', () => {
  const snaps = [{ path: 'c', at: 300 }, { path: 'b', at: 200 }, { path: 'a', at: 100 }]; // newest first
  const at = (ms) => new Date(ms).toISOString();
  assert.equal(baselineFor({ reviewed: at(150) }, snaps).path, 'b');
  assert.equal(baselineFor({ reviewed: at(200) }, snaps).path, 'b');
  assert.equal(baselineFor({ reviewed: '' }, snaps).path, 'a');
  assert.equal(baselineFor({ reviewed: '' }, []), '');
  assert.equal(baselineFor({ reviewed: at(400) }, snaps), null);
});

test('changed lines skip the frontmatter and match moved text', () => {
  const before = note('tandem-changed: 1', '# P\n\n## Remembered\n\n- one\n- two\n');
  const now = note('tandem-changed: 2', '# P\n\n## Remembered\n\n- one\n- two, now three (2026-11-05, PR 1)\n- four\n');
  assert.deepEqual([...changedLines(before, now)], [8, 9]);
  assert.deepEqual([...changedLines('', '# New\n\nbody\n')], [0, 2]);
  assert.deepEqual([...changedLines(now, now)], []);
});

test('blocks to mark: a block holds the lines up to the next block', () => {
  assert.deepEqual([...blocksToMark([0, 4, 2], new Set([3]))], [2]);
  assert.deepEqual([...blocksToMark([0, 4], new Set([9]))], [4]);
  assert.deepEqual([...blocksToMark([5], new Set([1]))], []);
});

test('index, search is:review, products list and the summary count', () => {
  const ix = buildIndex([
    { path: 'products/wiki-edge.md', content: note('title: Wiki Edge\ntandem-changed: 2026-11-05T10:00:00Z'), mtime: 2 },
    { path: 'products/stencil.md', content: note('title: Stencil\ntandem-changed: 2026-11-01\nreviewed: 2026-11-02'), mtime: 1 },
    { path: 'templates/product.md', content: STARTERS['templates/product.md'], mtime: 1 },
    { path: 'daily/2026-11-05.md', content: '# Today\n', mtime: 3 }
  ]);
  assert.deepEqual(toReview(ix).map(n => n.path), ['products/wiki-edge.md']);
  assert.deepEqual(productNotes(ix).map(n => n.title), ['Stencil', 'Wiki Edge']);
  const contents = new Map([...ix.notes.keys()].map(p => [p, '']));
  assert.deepEqual(search(ix, contents, 'is:review').map(r => r.path), ['products/wiki-edge.md']);
  const card = notesCards(ix).find(c => c.id === 'review');
  assert.deepEqual(card, { id: 'review', kind: 'count', title: 'Product notes to review', count: 1, route: 'review' });
});

test('the product template is a starter and fills its tag from the title', () => {
  const t = fill(STARTERS['templates/product.md'], { title: 'Wiki Edge' });
  assert.match(t, /^---\ntitle: Wiki Edge\n/);
  assert.deepEqual(facts(t).tags, ['product', 'product/wiki-edge']);
  assert.ok(missingStarters(new Set()).some(s => s.path === 'templates/product.md'));
});
