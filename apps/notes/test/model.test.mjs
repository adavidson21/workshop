// Notes: paths, index, search, tree and link rewriting (apps/notes/js/model.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, freePath, localHref, parseQuery, relativeLink, relink, resolvePath, search, slugify, tree, validFolder } from '../js/model.js';

const NOTES = [
  { path: 'runbooks/deploy.md', content: '# Deploy\n\nSee the [guide](../guide.md#setup) and [[Guide]].\n\n![d](../attachments/d.png) #ops\n\n```\n[guide](../guide.md)\n```\n' },
  { path: 'guide.md', content: '---\ntitle: The Guide\ntags: [ops, team/platform]\n---\nBack to [deploy](runbooks/deploy.md), [self](guide.md) and [[nowhere]].\n' },
  { path: 'runbooks/rollback.md', content: '# Rollback\n\nUndo a [deploy](deploy.md). #ops/incident\n' }
];

test('names: slugs, free paths and folders follow Workshop name rules', () => {
  assert.equal(slugify('Déploy Runbook (v2)!'), 'deploy-runbook-v2');
  assert.equal(slugify('***'), 'untitled');
  assert.equal(slugify('x'.repeat(60)).length, 40);
  const taken = new Set(['a/plan.md', 'a/plan-2.md']);
  assert.equal(freePath(taken, 'a', 'plan', 'md'), 'a/plan-3.md');
  assert.equal(freePath(taken, '', 'plan', 'md'), 'plan.md');
  assert.equal(freePath(new Set(['x'.repeat(40) + '.md']), '', 'x'.repeat(40), 'md'), 'x'.repeat(38) + '-2.md');
  assert.equal(validFolder('a/b/c'), true);
  assert.equal(validFolder('a/b/c/d'), false, 'at most 3 folders: a path has at most 4 segments');
  assert.equal(validFolder('My Notes'), false);
});

test('paths: resolve and relative links round trip, and never leave the app folder', () => {
  assert.equal(resolvePath('a/b/c.md', '../d.md'), 'a/d.md');
  assert.equal(resolvePath('a/c.md', './x/y.md'), 'a/x/y.md');
  assert.equal(resolvePath('c.md', '../x.md'), null);
  for (const [from, to] of [['a/b/c.md', 'a/x.md'], ['c.md', 'a/b/d.md'], ['a/b.md', 'a/c.md'], ['x/y.md', 'z/w.md']]) {
    assert.equal(resolvePath(from, relativeLink(from, to)), to, `${from} -> ${to}`);
  }
  assert.equal(relativeLink('a/b/c.md', 'a/x.md'), '../x.md');
  assert.deepEqual(localHref('../my%20note.md#part-2'), { path: '../my note.md', anchor: 'part-2' });
  assert.equal(localHref('https://x.test/a.md'), null);
  assert.equal(localHref('mailto:a@b.c'), null);
  assert.equal(localHref('/etc/passwd'), null);
});

test('index: titles, backlinks with lines, missing links and tags', () => {
  const ix = buildIndex(NOTES);
  assert.equal(ix.notes.get('guide.md').title, 'The Guide');
  assert.deepEqual(ix.backlinks.get('guide.md'), [{ from: 'runbooks/deploy.md', line: 2 }], 'a link and a [[wikilink]] on one line count once');
  assert.deepEqual(ix.backlinks.get('runbooks/deploy.md').map(b => b.from), ['guide.md', 'runbooks/rollback.md']);
  assert.equal(ix.backlinks.has('runbooks/rollback.md'), false);
  assert.deepEqual([...ix.missing], [['nowhere.md', ['guide.md']]]);
  assert.deepEqual([...ix.tags.keys()], ['ops', 'ops/incident', 'team/platform']);
  assert.ok(!ix.backlinks.get('guide.md').some(b => b.from === 'guide.md'), 'a link to itself is not a backlink');
});

test('search: words in titles, paths and text, tag: and path: filters', () => {
  const ix = buildIndex(NOTES);
  const text = new Map(NOTES.map(n => [n.path, n.content]));
  assert.deepEqual(parseQuery('deploy tag:ops path:runbooks #x'), { words: ['deploy'], tags: ['ops', 'x'], paths: ['runbooks'], langs: [], has: [], review: false });
  assert.deepEqual(search(ix, text, 'undo').map(r => [r.path, r.line]), [['runbooks/rollback.md', 2]]);
  assert.equal(search(ix, text, 'deploy')[0].path, 'runbooks/deploy.md', 'a title match ranks first');
  assert.deepEqual(search(ix, text, 'tag:team').map(r => r.path), ['guide.md'], 'a tag matches its children');
  assert.deepEqual(search(ix, text, 'tag:ops path:runbooks').map(r => r.path).sort(), ['runbooks/deploy.md', 'runbooks/rollback.md']);
  assert.deepEqual(search(ix, text, ''), []);
  assert.deepEqual(search(ix, text, 'zzz'), []);
});

test('tree: folders first, attachments hidden, empty folders only when made here', () => {
  const t = tree(['b.md', 'a/x.md', 'a/b/y.md', 'attachments/i.png', 'z/q.md'], ['new', 'attachments', 'a/b/c/d']);
  assert.deepEqual(t.notes, ['b.md']);
  assert.deepEqual(t.folders.map(f => f.path), ['a', 'new', 'z']);
  assert.deepEqual(t.folders[0].folders.map(f => f.path), ['a/b']);
  assert.deepEqual(t.folders[0].folders[0].notes, ['a/b/y.md']);
});

test('relink: renaming a note updates links to it; code and other links are untouched', () => {
  const ix = buildIndex(NOTES);
  const moves = new Map([['guide.md', 'docs/guide-v2.md']]);
  const deploy = relink(NOTES[0].content, 'runbooks/deploy.md', moves, ix);
  assert.equal(deploy.count, 2);
  assert.match(deploy.content, /\[guide\]\(\.\.\/docs\/guide-v2\.md#setup\)/);
  assert.match(deploy.content, /\[\[guide-v2\]\]/);
  assert.match(deploy.content, /```\n\[guide\]\(\.\.\/guide\.md\)\n```/, 'code is never changed');
  assert.match(deploy.content, /!\[d\]\(\.\.\/attachments\/d\.png\)/);
  assert.equal(relink(NOTES[2].content, 'runbooks/rollback.md', moves, ix).count, 0);
});

test('relink: a moved note keeps reaching what it linked to; links among moved notes follow both ends', () => {
  const ix = buildIndex(NOTES);
  const own = relink(NOTES[0].content, 'runbooks/deploy.md', new Map([['runbooks/deploy.md', 'deploy.md']]), ix);
  assert.match(own.content, /\[guide\]\(guide\.md#setup\)/);
  assert.match(own.content, /!\[d\]\(attachments\/d\.png\)/);
  const folder = new Map([['runbooks/deploy.md', 'ops/run/deploy.md'], ['runbooks/rollback.md', 'ops/run/rollback.md']]);
  const rb = relink(NOTES[2].content, 'runbooks/rollback.md', folder, ix);
  assert.equal(rb.count, 0, 'both moved together: the relative link is still right');
  const dep = relink(NOTES[0].content, 'runbooks/deploy.md', folder, ix);
  assert.match(dep.content, /\[guide\]\(\.\.\/\.\.\/guide\.md#setup\)/);
  const g = relink(NOTES[1].content, 'guide.md', folder, ix);
  assert.match(g.content, /\[deploy\]\(ops\/run\/deploy\.md\)/);
});
