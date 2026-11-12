// Notes: Markdown rendering and the facts the index reads (apps/notes/js/markdown.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { facts, frontmatter, render } from '../js/markdown.js';

const ctx = {
  resolveLink: (href) => (/\.md(#|$)/.test(href) ? { kind: 'note', path: href.split('#')[0], anchor: href.split('#')[1] } : null),
  imageUrl: (src) => (src.startsWith('http') ? null : { path: src }),
  wiki: (t) => (t === 'Known' ? { path: 'known.md' } : null)
};

test('blocks: headings, paragraphs, lists, tasks, quotes, tables, code and rules', () => {
  const html = render('# Title\n\nText *em* **strong** ~~gone~~ `code`.\n\n- a\n  - nested\n- [x] done\n\n1. one\n2. two\n\n> quoted\n\n| h | n |\n|---|--:|\n| x | 2 |\n\n```js\nlet a = 1;\n```\n\n---\n', ctx);
  assert.match(html, /<h1 id="h-title" data-line="0">Title<\/h1>/);
  assert.match(html, /<em>em<\/em> <strong>strong<\/strong> <del>gone<\/del> <code>code<\/code>/);
  assert.match(html, /<ul class="tasks"><li data-line="4">a<ul><li data-line="5">nested<\/li><\/ul><\/li><li data-line="6" class="task"><input type="checkbox" disabled checked> done<\/li><\/ul>/);
  assert.match(html, /<ol><li data-line="8">one<\/li><li data-line="9">two<\/li><\/ol>/);
  assert.match(html, /<blockquote><p data-line="11">quoted<\/p><\/blockquote>/);
  assert.match(html, /<th style="text-align:right">n<\/th>/);
  assert.match(html, /<pre data-line="17"><code data-lang="js"><span class="tok-k">let<\/span> a = <span class="tok-n">1<\/span>;<\/code><\/pre>/);
  assert.match(html, /<hr>/);
});

test('every piece of text is escaped; raw HTML shows as text', () => {
  const html = render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n| <b>x</b> |\n|---|\n| <iframe> |\n\n```\n</code><script>\n```\n\n# <style>h</style>', ctx);
  assert.ok(!/<script|<img src=x|<iframe|<style|<b>/i.test(html), html);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;\/code&gt;&lt;script&gt;/);
});

test('links: web links open outside, note links stay inside, other schemes are text', () => {
  const html = render('[web](https://example.com/a?b=1) [note](guide.md#setup) [js](javascript:alert`1`) [data](data:text/html,x) <https://x.test> [[Known]] [[Unknown|label]]', ctx);
  assert.match(html, /<a href="https:\/\/example.com\/a\?b=1" target="_blank" rel="noopener noreferrer">web<\/a>/);
  assert.match(html, /<a href="#" data-note="guide.md" data-anchor="setup" class="note-link">note<\/a>/);
  assert.ok(!/href="javascript|href="data:/i.test(html));
  assert.match(html, /<span class="bad-link"[^>]*>js<\/span>/);
  assert.match(html, /data-note="known.md" class="note-link">Known<\/a>/);
  assert.match(html, /data-missing="Unknown" class="note-link missing">label<\/a>/);
});

test('images: folder images are filled in by the page, remote ones are never loaded', () => {
  const html = render('![diagram](../attachments/d.png) ![remote](https://evil.test/x.png) ![x" onerror="y](a.png)', ctx);
  assert.match(html, /<img data-img="..\/attachments\/d.png" alt="diagram">/);
  assert.ok(!html.includes('src="https://evil.test'), 'remote image not used as a source');
  assert.match(html, /remote image not loaded/);
  assert.ok(!/onerror="y"/.test(html), 'alt text is escaped');
  const none = render('![gone](missing.png)', { imageUrl: () => null });
  assert.match(none, /image not found: gone/);
});

test('tags: inline #tags, not in code, headings or URLs', () => {
  const md = '---\ntags: [Ops, "team/platform"]\n---\n# Heading #nottag\n\nA #todo and #team/infra, not#this, `#code`, https://x.test/#frag\n\n```\n#fenced\n```\n';
  const f = facts(md);
  assert.deepEqual(f.tags, ['ops', 'team/infra', 'team/platform', 'todo']);
  assert.equal(f.title, 'Heading #nottag');
  const fm = frontmatter('---\ntags:\n  - one\n  - two\ntitle: "Named"\n---\nbody');
  assert.deepEqual(fm.data, { tags: ['one', 'two'], title: 'Named' });
  assert.equal(fm.body, 'body');
});

test('facts: links, wikilinks and headings with lines in the whole file', () => {
  const md = '---\ntitle: T\n---\n# One\n\nSee [a](a.md) and ![i](img/x.png).\n\n## Two\n\n- [[Other]] `[no](no.md)`\n';
  const f = facts(md);
  assert.equal(f.title, 'T');
  assert.deepEqual(f.links, [{ href: 'a.md', line: 5, image: false }, { href: 'img/x.png', line: 5, image: true }]);
  assert.deepEqual(f.wikilinks, [{ target: 'Other', line: 9 }]);
  assert.deepEqual(f.headings.map(h => [h.level, h.text, h.line]), [[1, 'One', 3], [2, 'Two', 7]]);
  assert.equal(facts('no heading', 'fallback').title, 'fallback');
});

test('emphasis edge cases stay safe and readable', () => {
  assert.equal(render('snake_case_name and 2 * 3 * 4'), '<p data-line="0">snake_case_name and 2 * 3 * 4</p>');
  assert.equal(render('**unclosed'), '<p data-line="0">**unclosed</p>');
  assert.equal(render('\\*not em\\*'), '<p data-line="0">*not em*</p>');
});
