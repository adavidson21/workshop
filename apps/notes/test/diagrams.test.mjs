// Folio: diagram starters and finding diagrams in a note (js/diagram-kits.js), and how they render and export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KITS, blockInsert, fenceAt, fences, kit, kitBlock, lineOf, mermaidFences } from '../js/diagram-kits.js';
import { render } from '../js/markdown.js';
import { wikiHtml } from '../js/export.js';

test('every kit has an id, a name, what it is for, and Mermaid code that names its kind first', () => {
  const ids = new Set();
  for (const k of KITS) {
    assert.ok(k.id && k.name && k.about && k.code, k.id);
    assert.ok(!ids.has(k.id), `duplicate ${k.id}`); ids.add(k.id);
    assert.match(k.code, /^[A-Za-z][\w-]*/);
    assert.ok(!k.code.includes('```'), 'no fence inside a kit');
  }
  assert.ok(['flowchart', 'sequence', 'erd', 'state', 'class', 'c4', 'gantt'].every(id => kit(id)));
  assert.equal(kit('nope'), null);
  assert.equal(kitBlock(kit('state')), '```mermaid\n' + kit('state').code + '\n```');
});

test('fences finds blocks with their lines and language, skipping frontmatter; fenceAt finds the diagram at a line', () => {
  const text = '---\ntitle: x\n---\n# T\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n~~~js\nlet a\n~~~\n\n````mermaid\nsequenceDiagram\n````\n';
  const all = fences(text);
  assert.deepEqual(all.map(f => [f.line, f.end, f.lang]), [[5, 8, 'mermaid'], [10, 12, 'js'], [14, 16, 'mermaid']]);
  assert.equal(all[0].src, 'flowchart LR\n  A --> B');
  assert.equal(mermaidFences(text).length, 2);
  assert.equal(fenceAt(text, 7).line, 5);
  assert.equal(fenceAt(text, 5).line, 5);
  assert.equal(fenceAt(text, 8).line, 5);
  assert.equal(fenceAt(text, 11), null, 'a js block is not a diagram');
  assert.equal(fenceAt(text, 3), null);
  assert.equal(fences('```mermaid\nA\n').length, 1, 'an unclosed fence runs to the end');
  assert.equal(lineOf('a\nb\nc', 4), 2);
});

test('blockInsert puts a block on lines of its own, with the cursor inside the fence', () => {
  const b = '```mermaid\nflowchart LR\n```';
  assert.deepEqual(blockInsert('', 0, 0, b), { insert: b + '\n', cursor: 11 });
  let r = blockInsert('Text', 4, 4, b);
  assert.equal(r.insert, '\n\n' + b + '\n');
  assert.equal(r.cursor, 2 + 11);
  r = blockInsert('A\n\nB', 3, 3, b);
  assert.equal(r.insert, b + '\n\n');
  r = blockInsert('A\nB', 2, 2, b);
  assert.equal(r.insert, '\n' + b + '\n\n');
  r = blockInsert('A sel B', 2, 5, b);
  assert.equal(('A ' + r.insert + ' B').includes('sel'), false, 'the selection is replaced');
});

test('a mermaid block renders as a diagram figure holding its escaped source; other code stays a code block', () => {
  const html = render('# T\n\n```mermaid\nflowchart LR\n  A["<b>x</b>"] --> B\n```\n\n```js\nx\n```\n');
  assert.match(html, /<figure class="diagram" data-line="2"><pre class="diagram-src"><code data-lang="mermaid">flowchart LR\n  A\[&quot;&lt;b&gt;x&lt;\/b&gt;&quot;\] --&gt; B<\/code><\/pre><\/figure>/);
  assert.match(html, /<pre data-line="7"><code data-lang="js">x<\/code><\/pre>/);
  assert.match(render('```Mermaid\nA\n```'), /figure class="diagram"/, 'the language name is not case sensitive');
});

test('Copy for wiki: the HTML gets each diagram as a PNG, and only a data:image URL; a diagram with no picture stays as code', () => {
  const md = '# T\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n```mermaid\nbroken\n```\n';
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const html = wikiHtml(md, new Map([['flowchart LR\n  A --> B', png], ['broken', 'javascript:alert(1)']]));
  assert.ok(html.includes(`<img src="${png}" alt="Diagram">`), html);
  assert.ok(!html.includes('javascript:'), 'a URL that is not a data:image is never used');
  assert.match(html, /<pre><code>broken<\/code><\/pre>/);
  assert.ok(!html.includes('figure'), 'no Folio-only markup in the HTML');
});
