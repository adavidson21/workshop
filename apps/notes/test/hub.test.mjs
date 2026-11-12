// Folio: embeds (js/embeds.js), the map of links (js/map.js) and the self-contained page (export.js pageHtml).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embedHtml, embedSpec, sectionText } from '../js/embeds.js';
import { noteMap, nodeAt } from '../js/map.js';
import { facts, render } from '../js/markdown.js';
import { buildIndex } from '../js/model.js';
import { pageHtml } from '../js/export.js';

test('embedSpec reads ![[note]], ![[note#heading]] and ![label](note.md#heading), alone in a paragraph', () => {
  assert.deepEqual(embedSpec('![[Deploy plan]]'), { target: 'Deploy plan', anchor: '', wiki: true });
  assert.deepEqual(embedSpec(' ![[deploy#Roll back|x]] '), { target: 'deploy', anchor: 'Roll back', wiki: true });
  assert.deepEqual(embedSpec('![[#Setup]]'), { target: '', anchor: 'Setup', wiki: true });
  assert.deepEqual(embedSpec('![the plan](runbooks/deploy.md#roll-back)'), { target: 'runbooks/deploy.md', anchor: 'roll-back', wiki: false });
  assert.equal(embedSpec('![shot](attachments/a.png)'), null, 'an image is not an embed');
  assert.equal(embedSpec('See ![[x]]'), null, 'only a paragraph that is just the embed');
  assert.equal(embedSpec('![[]]'), null);
});

test('sectionText gives a heading and what follows to the next heading at its level; headings in code do not count', () => {
  const text = '---\ntitle: x\n---\n# Deploy\n\nIntro.\n\n## Steps\n\n1. Go\n\n### Detail\n\n```\n## not a heading\n```\n\n## Roll back\n\nUndo.\n';
  assert.equal(sectionText(text, ''), text.slice(text.indexOf('# Deploy')));
  assert.equal(sectionText(text, 'steps'), '## Steps\n\n1. Go\n\n### Detail\n\n```\n## not a heading\n```');
  assert.equal(sectionText(text, 'Roll back'), '## Roll back\n\nUndo.');
  assert.equal(sectionText(text, 'nope'), null);
});

test('a paragraph that is an embed becomes the embed\'s HTML; embedHtml drops line numbers, ids and tickable boxes', () => {
  const html = render('# A\n\n![[b]]\n\nText ![[b]] inline.\n', { embed: (p) => (p.trim() === '![[b]]' ? '<p>B</p>' : null) });
  assert.match(html, /<div class="embed" data-line="2"><p>B<\/p><\/div>/);
  assert.match(html, /<p data-line="4">Text !/);
  const inner = embedHtml(render('## H\n\n- [ ] t\n', { tasks: true }));
  assert.ok(!/data-line|id="h-|data-task/.test(inner), inner);
  assert.match(inner, /<input type="checkbox" disabled>/);
  const f = facts('![x](other.md#h)\n\n![y](pic.png)\n');
  assert.deepEqual(f.links.map(l => [l.href, l.image]), [['other.md#h', false], ['pic.png', true]], 'an embed links to its note (backlinks see it)');
});

test('noteMap: the note, what it links to and what links to it, with the links among them; nodeAt reads a drawn id', () => {
  const ix = buildIndex([
    { path: 'a.md', content: '# A "quoted" #1\n\n[b](b.md) [c](c.md) [gone](gone.md) ![img](x.png)\n', mtime: 1 },
    { path: 'b.md', content: '# B\n\n[c](c.md)\n', mtime: 1 },
    { path: 'c.md', content: '# C\n', mtime: 1 },
    { path: 'd.md', content: '# D\n\n[[A \"quoted\" #1]] and [a](a.md)\n', mtime: 1 },
    { path: 'e.md', content: '# E\n', mtime: 1 }
  ]);
  const m = noteMap(ix, 'a.md');
  assert.deepEqual(m.nodes, ['a.md', 'b.md', 'c.md', 'd.md']);
  assert.match(m.code, /^flowchart LR\n {2}n0\(\["A #quot;quoted#quot; #35;1"\]\)/);
  for (const e of ['n0 --> n1', 'n0 --> n2', 'n1 --> n2', 'n3 --> n0']) assert.ok(m.code.includes(e), e);
  assert.ok(!m.code.includes('gone') && !m.code.includes('E"'), 'missing notes and unrelated notes are left out');
  assert.equal(m.more, 0);
  assert.equal(noteMap(ix, 'a.md', 2).more, 2);
  assert.equal(noteMap(ix, 'nope.md'), null);
  assert.equal(nodeAt('folio-d3-flowchart-n12-12'), 12);
  assert.equal(nodeAt('something-else'), -1);
});

test('pageHtml: a complete page with its own CSP; heading and footnote links work, note links are text', () => {
  const svg = 'data:image/svg+xml;base64,PHN2Zz4=';
  const page = pageHtml('# Title\n\nSee [steps](#steps), [other](other.md) and #tag[^1].\n\n## Steps\n\n```mermaid\nflowchart LR\n```\n\n```mermaid\nbad\n```\n\n[^1]: Note.\n', { title: 'My <note>', diagrams: new Map([['flowchart LR', svg], ['bad', 'javascript:x']]) });
  assert.ok(page.startsWith('<!doctype html>'));
  assert.match(page, /<title>My &lt;note&gt;<\/title>/);
  assert.match(page, /Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'"/);
  assert.match(page, /<a href="#h-steps">steps<\/a>, other and #tag/);
  assert.match(page, /<h2 id="h-steps">Steps<\/h2>/);
  assert.ok(page.includes(`<img src="${svg}" alt="Diagram">`));
  assert.ok(!page.includes('javascript:'));
  assert.match(page, /<a href="#h-fn-1">1<\/a>/);
  assert.ok(!/ data-/.test(page.slice(page.indexOf('<body'))), 'no Folio-only attributes');
  assert.ok(!/<script/i.test(page));
});
