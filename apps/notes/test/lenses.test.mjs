// Folio: spike briefs read by lens (apps/notes/js/lenses.js) and their Download HTML (export.js pageHtml).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefLenses, lensMarkdown } from '../js/lenses.js';
import { pageHtml } from '../js/export.js';

const BRIEF = `# Spike findings: Bulk export

Date: 2026-11-12
Size: M
Lenses: business, engineering, leadership
Default lens: leadership

## The ask

> How hard is bulk export?

## Short answer

### For business

Customers get it in a month.

### For engineering

Reuse the export queue.

### For leadership

Approve four weeks.

## Options

### For engineering

| A | B |
|---|---|
| 1 | 2 |

\`\`\`
### For business
not a heading in code
\`\`\`

## Sources

- a file
`;

test('briefLenses: lenses in order, default lens, and null for other pages', () => {
  assert.deepEqual(briefLenses(BRIEF), { lenses: ['business', 'engineering', 'leadership'], open: 'leadership' });
  assert.deepEqual(briefLenses('# X\n\nLenses: leadership, sales, business\n'), { lenses: ['business', 'leadership'], open: 'business' });
  assert.deepEqual(briefLenses('# X\n\nLenses: engineering, business\nDefault lens: sales\n').open, 'engineering');
  assert.equal(briefLenses('# Plan\n\nStatus: DRAFT\n'), null);
  assert.equal(briefLenses('# X\n\n## A\n\nLenses: business\n'), null, 'only before the first section');
});

test('lensMarkdown keeps shared text and its own blocks, drops other lenses and empty sections', () => {
  const lead = lensMarkdown(BRIEF, 'leadership');
  assert.match(lead, /How hard is bulk export/);
  assert.match(lead, /Approve four weeks/);
  assert.doesNotMatch(lead, /Customers get it|Reuse the export queue|### For/);
  assert.doesNotMatch(lead, /## Options/, 'Options has only an engineering block');
  assert.match(lensMarkdown(BRIEF, 'engineering'), /\| 1 \| 2 \|\n\n```\n### For business\nnot a heading in code\n```/, 'a heading inside code does not start a block');
  assert.match(lead, /## Sources/);
  const biz = lensMarkdown(BRIEF, 'business');
  assert.match(biz, /Customers get it in a month/);
  assert.doesNotMatch(biz, /\| A \| B \|/);
  const eng = lensMarkdown('# T\n\nLenses: business, engineering\n\n## Only biz\n\n### For business\n\nx\n\n## Shared\n\ny\n', 'engineering');
  assert.doesNotMatch(eng, /Only biz/, 'a section with nothing for this lens is dropped');
  assert.match(eng, /## Shared\n\ny/);
});

test('pageHtml with lenses: a radio switch, one view per lens, the open lens checked, no script', () => {
  const b = briefLenses(BRIEF);
  const html = pageHtml(BRIEF, { title: 'Bulk export', lenses: { lenses: b.lenses, open: 'business' } });
  assert.match(html, /id="lv-business" class="lens-radio" checked/);
  assert.doesNotMatch(html, /id="lv-leadership" class="lens-radio" checked/);
  assert.match(html, /<label for="lv-engineering" class="lt-engineering">Engineering<\/label>/);
  assert.match(html, /<div class="lens-view lv-business">[\s\S]*Customers get it in a month[\s\S]*<\/div>/);
  assert.match(html, /#lv-leadership:checked~main \.lens-view:not\(\.lv-leadership\)\{display:none\}/);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
});

test('pageHtml without lenses is unchanged in shape', () => {
  const html = pageHtml('# Note\n\nHi', { title: 'Note' });
  assert.doesNotMatch(html, /lens-/);
  assert.match(html, /<main class="md"><h1[^>]*>Note<\/h1>/);
});
