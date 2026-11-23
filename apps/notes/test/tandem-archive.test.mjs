// Archived Tandem runs (Notes 4.14.0, js/tandem-archive.js): hidden, not deleted, and back when they need you.
// Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archivedAt, blank, hidden, readable, setArchived, splitRuns } from '../js/tandem-archive.js';

const run = (folder, o = {}) => ({ folder, title: folder, review: null, files: [{ file: 'brief.md', mtime: 1000 }], ...o });

test('archive and unarchive a run; the envelope stays readable', () => {
  let env = setArchived(blank(), 'docs-a', true, 5000);
  env = setArchived(env, 'spike-b', true, 6000);
  assert.ok(readable(env));
  assert.deepEqual([...archivedAt(env)], [['docs-a', 5000], ['spike-b', 6000]]);
  env = setArchived(env, 'docs-a', false);
  assert.deepEqual([...archivedAt(env).keys()], ['spike-b']);
  assert.equal(archivedAt({ schema: 'other', version: 1, items: [{ id: 'x' }] }).size, 0, 'an unreadable envelope archives nothing');
});

test('an archived run stays hidden until Tandem waits on you or changes a file in it', () => {
  assert.equal(hidden(run('a'), undefined), false, 'not archived');
  assert.equal(hidden(run('a'), 5000), true);
  assert.equal(hidden(run('a', { review: 'plan.md' }), 5000), false, 'waiting on your review');
  assert.equal(hidden(run('a', { files: [{ file: 'brief.md', mtime: 9000 }] }), 5000), false, 'changed since');
});

test('splitRuns keeps the order given', () => {
  const at = new Map([['b', 5000]]);
  const { shown, archived } = splitRuns([run('a'), run('b'), run('c')], at);
  assert.deepEqual(shown.map(r => r.folder), ['a', 'c']);
  assert.deepEqual(archived.map(r => r.folder), ['b']);
});

test('the Tandem section: Archive on each run, archived runs folded under Archived with Unarchive', async () => {
  const { sidebar } = await import('../js/view.js');
  const items = [run('docs-a'), run('spike-b'), run('41207-x', { review: 'plan.md', files: [{ file: 'plan.md', mtime: 1000 }] })];
  const state = { notes: { loaded: true }, ui: { query: '', section: 'tandem', path: '' }, tandem: { available: true, loaded: true, items }, archivedAt: new Map([['spike-b', 5000]]) };
  const html = sidebar(state);
  assert.match(html, /data-act="tandem-archive" data-folder="docs-a"/);
  assert.doesNotMatch(html, /data-act="tandem-archive" data-folder="41207-x"/, 'a run waiting on you is not archived');
  assert.match(html, /<details class="arch-runs"><summary class="section-label">Archived <span class="count">1<\/span>[\s\S]*data-act="tandem-unarchive" data-folder="spike-b"/);
});
