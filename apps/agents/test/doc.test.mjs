// doc.js: the .work file sheet's renderer and helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docHtml, lockReason, notebookRoute } from '../js/doc.js';

test('docHtml escapes everything and writes only its own markup', () => {
  const html = docHtml('# Plan: 41207\n\n<script>alert(1)</script> and **bold** `x<y`\n');
  assert.ok(!html.includes('<script>'));
  assert.match(html, /<h2>Plan: 41207<\/h2>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>x&lt;y<\/code>/);
});

test('docHtml links only http(s), in a new tab', () => {
  assert.match(docHtml('[ADO](https://dev.azure.com/x?a=1&b=2)'), /<a href="https:\/\/dev.azure.com\/x\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">ADO<\/a>/);
  assert.ok(!docHtml('[x](javascript:alert(1))').includes('<a'));
});

test('docHtml lists, tasks, nesting, code, tables, quotes, rules', () => {
  const html = docHtml('- [ ] Do it\n- [x] Done\n- Plain\n  - Child\n\n1. One\n2. Two\n\n```\n<b>\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> quoted\n\n---\n');
  assert.match(html, /<li class="task"><span class="box" aria-hidden="true"><\/span>Do it<\/li>/);
  assert.match(html, /<li class="task done">/);
  assert.match(html, /<li>Plain<ul><li>Child<\/li><\/ul><\/li>/, 'plain bullets keep their marker beside tasks');
  assert.match(html, /<ol><li>One<\/li><li>Two<\/li><\/ol>/);
  assert.match(html, /<pre><code>&lt;b&gt;<\/code><\/pre>/);
  assert.match(html, /<th>A<\/th><th>B<\/th>.*<td>1<\/td><td>2<\/td>/);
  assert.match(html, /<blockquote><p>quoted<\/p><\/blockquote>/);
  assert.match(html, /<hr>/);
});

test('docHtml drops HTML comments and frontmatter', () => {
  assert.equal(docHtml('---\ntitle: x\n---\nHi <!-- hidden -->'), '<p>Hi</p>');
});

test('lockReason and notebookRoute', () => {
  assert.equal(lockReason({ busy: false, auto: false }), '');
  assert.match(lockReason({ busy: true }), /Tandem is working/);
  assert.match(lockReason({ auto: true }), /Autopilot/);
  assert.equal(notebookRoute('41207-fix login', 'plan.md'), 'tandem/41207-fix%20login/plan.md');
});
