// Folio: developer docs. Syntax colors (js/highlight.js), callouts, footnotes, code facts and search filters,
// the new starter templates, and how they export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlight, langOf } from '../js/highlight.js';
import { facts, render } from '../js/markdown.js';
import { buildIndex, parseQuery, search } from '../js/model.js';
import { wikiHtml } from '../js/export.js';
import { STARTERS, fill } from '../js/templates.js';
import { templateInfo } from '../js/template-info.js';
import { mermaidFences } from '../js/diagram-kits.js';

const strip = (h) => h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

test('highlight colors the common languages and gives back exactly the code as text', () => {
  const cases = {
    js: 'const x = "a<b"; // note\nawait fetch(`/api/${id}`)',
    ts: 'interface User { id: number }\nexport type Id = string',
    python: 'def f(x):\n    """doc"""\n    return None  # done',
    sql: "SELECT id FROM users WHERE name = 'O''Brien' -- c",
    bash: 'echo "$HOME" --verbose # c',
    json: '{"a": true, "b": [1, "x"]}',
    yaml: 'name: folio\nitems:\n  - key: 1 # c',
    csharp: 'public async Task<int> Get() { var s = $"x{y}"; }',
    html: '<div class="a" onclick="x()">t</div><!-- c -->',
    css: '.a { color: #fff; --gap: 2rem; }',
    go: 'func main() { fmt.Println("hi") }',
    diff: '@@ -1 +1 @@\n-old\n+new'
  };
  for (const [lang, code] of Object.entries(cases)) {
    const h = highlight(code, lang);
    assert.equal(strip(h), code, `${lang}: the text is unchanged`);
    assert.match(h, /class="tok-/, `${lang}: something is colored`);
    assert.ok(!/<(?!\/?span)/.test(h), `${lang}: no markup but spans`);
  }
  assert.match(highlight('const a', 'js'), /<span class="tok-k">const<\/span>/);
  assert.match(highlight('select 1', 'sql'), /<span class="tok-k">select<\/span>/, 'SQL keywords in any case');
  assert.match(highlight('{"k": 1}', 'json'), /<span class="tok-a">&quot;k&quot;<\/span>/);
  assert.match(highlight('-old', 'diff'), /<span class="tok-del">-old<\/span>/);
});

test('highlight escapes everything; an unknown language is only escaped', () => {
  const evil = '</code><script>alert(1)</script>"\'&';
  for (const l of ['js', 'html', 'sql', 'nope', '', 'diff']) assert.ok(!/<script|<\/code/i.test(highlight(evil, l)), l);
  assert.equal(highlight('<b>x</b>', 'brainfuck'), '&lt;b&gt;x&lt;/b&gt;');
  assert.equal(langOf('TypeScript'), 'ts');
  assert.equal(langOf('yml'), 'yaml');
  assert.equal(langOf('mermaid'), null);
});

test('callouts: > [!NOTE] and friends, with an optional title; anything else stays a quote', () => {
  const html = render('> [!WARNING] Careful *now*\n> Body text.\n\n> [!tip]\n> Short.\n\n> [!NOPE]\n> plain\n\n> just a quote\n');
  assert.match(html, /<div class="callout callout-warning" data-line="0" role="note"><p class="callout-title">Careful <em>now<\/em><\/p><p data-line="1">Body text.<\/p><\/div>/);
  assert.match(html, /<div class="callout callout-tip" data-line="3" role="note"><p class="callout-title">Tip<\/p><p data-line="4">Short.<\/p><\/div>/);
  assert.match(html, /<blockquote><p data-line="6">\[!NOPE\]\nplain<\/p><\/blockquote>/);
  assert.match(html, /<blockquote><p data-line="9">just a quote<\/p><\/blockquote>/);
  assert.ok(!render('> [!NOTE] <script>x</script>').includes('<script'), 'the title is escaped');
  assert.deepEqual(facts('> [!NOTE]\n> See [x](x.md) #ops\n').links.map(l => l.href), ['x.md'], 'links inside a callout count');
});

test('footnotes: numbered by first reference, written at the end, with links both ways', () => {
  const html = render('Second[^b] and first[^a] and again[^b].\n\n[^a]: The *a* note.\n[^b]: The b note,\n  over two lines.\n[^c]: Never used.\n\nAfter.\n');
  assert.match(html, /Second<sup class="fn-ref" id="h-fnref-b"><a href="#" data-anchor="fn-b" class="note-link" title="Footnote 1">1<\/a><\/sup>/);
  assert.match(html, /first<sup class="fn-ref" id="h-fnref-a"><a [^>]*>2<\/a><\/sup>/);
  assert.match(html, /again<sup class="fn-ref"><a [^>]*>1<\/a><\/sup>/, 'only the first reference has the id');
  assert.match(html, /<p data-line="7">After.<\/p><section class="footnotes"/, 'definitions are not in the text');
  const notes = html.slice(html.indexOf('<section'));
  assert.ok(notes.indexOf('id="h-fn-b"') < notes.indexOf('id="h-fn-a"') && notes.indexOf('id="h-fn-a"') < notes.indexOf('id="h-fn-c"'));
  assert.match(notes, /The b note,\nover two lines\./);
  assert.match(notes, /The <em>a<\/em> note\./);
  assert.match(notes, /data-anchor="fnref-a"/);
  assert.equal(render('No notes[^x] here.'), '<p data-line="0">No notes[^x] here.</p>', 'a reference with no definition stays text');
});

test('facts list code languages and open tasks; search filters by lang: and has:', () => {
  const f = facts('# A\n\n```sql\nselect 1\n```\n\n```mermaid\nflowchart LR\n```\n\n```\nplain\n```\n\n- [ ] open\n- [x] done\n- [ ] also\n');
  assert.deepEqual(f.code.sort(), ['', 'mermaid', 'sql']);
  assert.equal(f.tasks, 2);
  const ix = buildIndex([
    { path: 'db.md', content: '# DB\n\n```sql\nselect 1\n```\n', mtime: 1 },
    { path: 'arch.md', content: '# Arch\n\n```mermaid\nflowchart LR\n```\n\n![x](attachments/a.png)\n', mtime: 1 },
    { path: 'todo.md', content: '# Todo\n\n- [ ] ship [db](db.md)\n', mtime: 1 }
  ]);
  const contents = new Map([...ix.notes.keys()].map(p => [p, '']));
  const q = (s) => search(ix, contents, s).map(r => r.path).sort();
  assert.deepEqual(q('lang:sql'), ['db.md']);
  assert.deepEqual(q('has:diagram'), ['arch.md']);
  assert.deepEqual(q('has:code'), ['db.md'], 'a diagram is not code');
  assert.deepEqual(q('has:task'), ['todo.md']);
  assert.deepEqual(q('has:image'), ['arch.md']);
  assert.deepEqual(q('has:link'), ['todo.md']);
  assert.deepEqual(q('has:diagram has:task'), []);
  assert.deepEqual(parseQuery('has:nothing').words, ['has:nothing'], 'an unknown has: is a word');
});

test('the developer starter templates are named, fill in, and their diagrams are mermaid blocks', () => {
  for (const [stem, name] of [['design-doc', 'Design doc'], ['api-endpoint', 'API endpoint'], ['architecture', 'Architecture overview'], ['postmortem', 'Postmortem']]) {
    const path = `templates/${stem}.md`;
    assert.ok(STARTERS[path], path);
    assert.equal(templateInfo(path, STARTERS[path]).name, name);
    const text = fill(STARTERS[path], { title: 'Billing service' });
    assert.ok(text.startsWith('# Billing service\n'), stem);
    assert.ok(mermaidFences(text).length >= 1, `${stem} has a diagram`);
    assert.ok(!text.includes('{{'), `${stem}: every placeholder filled`);
  }
});

test('Copy for wiki HTML: no syntax-color spans, callouts as quotes with a bold title', () => {
  const html = wikiHtml('> [!NOTE] Heads up\n> Body.\n\n```js\nconst a = 1\n```\n\nText[^1].\n\n[^1]: Foot.\n');
  assert.ok(!html.includes('tok-'), html);
  assert.match(html, /<pre><code>const a = 1<\/code><\/pre>/);
  assert.match(html, /<blockquote><p><strong>Heads up<\/strong><\/p><p>Body.<\/p><\/blockquote>/);
  assert.ok(!html.includes('class="callout'));
});
