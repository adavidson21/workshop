// Folio: Copy for wiki's Markdown (export.js wikiMarkdown) and embeds expanded into it (embeds.js expandEmbeds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wikiMarkdown } from '../js/export.js';
import { expandEmbeds } from '../js/embeds.js';

test('wikiMarkdown drops frontmatter and turns links into the folder into their text', () => {
  const md = '---\ntitle: x\ntags: [a]\n---\n# T\n\nSee [a](a.md#h), [[B note|bee]], [[C#Sub]], [web](https://x.io), [here](#steps), ![img](p.png), [pdf](files/a.pdf) and [[D]].\n';
  assert.equal(wikiMarkdown(md), '# T\n\nSee a, bee, C › Sub, [web](https://x.io), [here](#steps), ![img](p.png), pdf and D.\n');
  assert.equal(wikiMarkdown('`[x](y.md)` and\n\n```\n[x](y.md) [[z]]\n```\n'), '`[x](y.md)` and\n\n```\n[x](y.md) [[z]]\n```\n', 'code is left alone');
  assert.equal(wikiMarkdown('[mail](mailto:a@b.c) [s](//x.io/a.md)'), '[mail](mailto:a@b.c) [s](//x.io/a.md)');
  assert.equal(wikiMarkdown('No frontmatter\n---\nnot: it\n---\n'), 'No frontmatter\n---\nnot: it\n---\n', 'only frontmatter at the very top');
});

test('expandEmbeds replaces embed lines with their text, nested two deep, never looping, never in code', async () => {
  const notes = {
    'a.md': '# A\n\n![[B]]\n\nAfter.',
    'b.md': '## B part\n\nB text.\n\n![[C]]',
    'c.md': 'C text.\n\n![[D]]',
    'd.md': 'D text.',
    'self.md': '![[Self]]'
  };
  const load = async (spec) => { const p = `${spec.target.toLowerCase()}.md`; return notes[p] !== undefined ? { path: p, text: notes[p] } : null; };
  assert.equal(await expandEmbeds(notes['a.md'], 'a.md', load), '# A\n\n## B part\n\nB text.\n\nC text.\n\n![[D]]\n\nAfter.', 'two levels, then the third stays an embed');
  assert.equal(await expandEmbeds('x\n\n![[Self]]', 'self.md', load), 'x\n\n![[Self]]', 'a note inside itself stays as written');
  assert.equal(await expandEmbeds('![[Nope]]', 'a.md', load), '![[Nope]]');
  assert.equal(await expandEmbeds('```\n![[B]]\n```', 'a.md', load), '```\n![[B]]\n```');
  assert.equal(await expandEmbeds('text\n![[B]]', 'a.md', load), 'text\n![[B]]', 'only a line on its own, like a paragraph');
});
