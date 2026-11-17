// Folio 4.6.0 and 4.7.0: highlights, word count, aliases, properties and bookmarks (markdown.js, model.js, props.js, bookmarks.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { facts, inline, plainText, render } from '../js/markdown.js';
import { buildIndex, linkMention, resolveWiki, search, unlinkedMentions, wordCount } from '../js/model.js';
import { readProps, removeProp, setProp, validKey } from '../js/props.js';
import { blank, followed, paths, readable, toggled } from '../js/bookmarks.js';

test('==highlights== render as <mark>; a lone == or spaced == stays text', () => {
  assert.equal(inline('a ==b c== d'), 'a <mark>b c</mark> d');
  assert.equal(inline('x == y'), 'x == y');
  assert.equal(inline('==open only'), '==open only');
  assert.equal(inline('**==both==**'), '<strong><mark>both</mark></strong>');
  assert.equal(inline('`==code==`'), '<code>==code==</code>');
  assert.equal(plainText('==hi== there'), 'hi there');
  assert.match(render('Some ==marked== text'), /<mark>marked<\/mark>/);
});

test('word count leaves out frontmatter and Markdown marks', () => {
  assert.deepEqual(wordCount(''), { words: 0, minutes: 0 });
  assert.deepEqual(wordCount('---\ntitle: Long title here\n---\n# Hello world\n\n- [ ] one **two** [three](a.md)'), { words: 5, minutes: 1 });
  assert.equal(wordCount('word '.repeat(700)).minutes, 3);
});

test('aliases: read from frontmatter, resolve [[links]] and match search, never take another note\'s title', () => {
  assert.deepEqual(facts('---\naliases: [JP, "John Paul"]\n---\n# T').aliases, ['JP', 'John Paul']);
  assert.deepEqual(facts('---\naliases:\n  - A\n  - B\n---\n').aliases, ['A', 'B']);
  assert.deepEqual(facts('# none').aliases, []);
  const ix = buildIndex([
    { path: 'people/jp.md', content: '---\naliases: [JP, Guide]\n---\n# John Paul Pennisi\n' },
    { path: 'guide.md', content: '# Guide\n' },
    { path: 'a.md', content: '# A\n\nAsk [[JP]] about the [[Guide]].\n' }
  ]);
  assert.equal(resolveWiki(ix.byTitle, ix.notes, 'jp'), 'people/jp.md');
  assert.equal(resolveWiki(ix.byTitle, ix.notes, 'Guide'), 'guide.md');
  assert.deepEqual(ix.backlinks.get('people/jp.md').map(b => b.from), ['a.md']);
  const hits = search(ix, new Map([['people/jp.md', '# John Paul Pennisi']]), 'jp');
  assert.equal(hits[0].path, 'people/jp.md');
});

test('properties: read, set, add and remove, leaving the body as it was', () => {
  const text = '---\ntitle: Deploy\ntags: [ops, team/platform]\naliases:\n  - Ship\nowner: jo\n---\n# Deploy\n\nBody.\n';
  assert.deepEqual(readProps(text), [
    { key: 'title', value: 'Deploy', list: false },
    { key: 'tags', value: 'ops, team/platform', list: true },
    { key: 'aliases', value: 'Ship', list: true },
    { key: 'owner', value: 'jo', list: false }
  ]);
  const a = setProp(text, 'aliases', 'Ship, Release');
  assert.match(a, /\naliases: \[Ship, Release\]\nowner: jo\n---\n# Deploy\n\nBody\.\n$/);
  assert.equal(readProps(setProp(text, 'owner', 'priya: lead')).find(p => p.key === 'owner').value, 'priya: lead');
  assert.match(setProp(text, 'status', 'draft'), /owner: jo\nstatus: draft\n---\n/);
  assert.equal(setProp('# Hi\n', 'status', 'draft'), '---\nstatus: draft\n---\n# Hi\n');
  assert.equal(setProp(text, 'bad key', 'x'), null);
  assert.doesNotMatch(removeProp(text, 'aliases'), /aliases|Ship/);
  assert.equal(removeProp('---\nonly: one\n---\n# Hi\n', 'only'), '# Hi\n');
  assert.equal(removeProp('# Hi\n', 'x'), '# Hi\n');
  assert.ok(validKey('due-date') && !validKey('1x') && !validKey(''));
  assert.deepEqual(readProps('# No frontmatter'), []);
});

test('bookmarks: toggle, follow moves, drop trashed notes', () => {
  let env = blank();
  env = toggled(env, 'a.md', 1);
  env = toggled(env, 'b/c.md', 2);
  assert.deepEqual(paths(env), ['a.md', 'b/c.md']);
  assert.deepEqual(paths(toggled(env, 'a.md')), ['b/c.md']);
  const moved = followed(env, new Map([['b/c.md', 'd/c.md']]), ['a.md']);
  assert.deepEqual(paths(moved), ['d/c.md']);
  assert.equal(followed(env, new Map([['x.md', 'y.md']])), null);
  assert.ok(readable(null) && !readable({ schema: 'notes.bookmarks', version: 2, items: [] }));
  assert.deepEqual(paths({ schema: 'other', version: 1, items: [{ id: 'z.md' }] }), []);
});

test('unlinked mentions: whole words in prose, not code, links, tags, frontmatter or templates', () => {
  const files = [
    ['deploy.md', '---\naliases: [Ship it]\n---\n# Deploy Runbook\n'],
    ['a.md', '---\nabout: deploy runbook\n---\n# A\nRead the Deploy runbook first. [deploy runbook](deploy.md), `deploy runbook`, #deploy-runbook, deploy runbooks\nwe ship it today\n```\ndeploy runbook\n```\n'],
    ['templates/t.md', '# T\ndeploy runbook\n']
  ];
  const ix = buildIndex(files.map(([path, content]) => ({ path, content })));
  const found = unlinkedMentions(ix, new Map(files), 'deploy.md');
  assert.deepEqual(found.map(m => [m.from, m.line, m.at, m.match]), [['a.md', 4, 9, 'Deploy runbook'], ['a.md', 5, 3, 'ship it']]);
  const next = linkMention(files[1][1], found[0], '[[Deploy runbook]]');
  assert.match(next, /Read the \[\[Deploy runbook\]\] first\./);
  assert.equal(linkMention('# changed\n', found[0], '[[x]]'), null);
  assert.deepEqual(unlinkedMentions(ix, new Map(files), 'missing.md'), []);
});
