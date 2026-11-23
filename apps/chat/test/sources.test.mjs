// Tests for js/sources.js: the Sources list at the end of an answer. Synthetic text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, sourcesHtml, splitSources } from '../js/sources.js';
import { textHtml } from '../js/parts.js';

test('a trailing Sources list is split off and each path is classified', () => {
  const t = 'Exports are capped at 10k rows.\n\nSources:\n- `C:/Users/me/Workshop/folio/products/sample-portal.md` (Gotchas)\n- `settings/glossary.json`\n- `portal-api/src/Export.cs`\n- `AGENTS.md`\n';
  const { body, sources } = splitSources(t);
  assert.equal(body, 'Exports are capped at 10k rows.');
  assert.deepEqual(sources.map(s => [s.kind, s.note || s.page || s.path]), [['note', 'products/sample-portal.md'], ['setting', 'glossary'], ['file', 'portal-api/src/Export.cs'], ['setting', 'repo-map']]);
});

test('other shapes: a heading, inline on one line, bold; a list that is not last is left alone', () => {
  assert.equal(splitSources('A\n\n## Sources\n\n1. `team/handbook.md`').sources[0].note, 'team/handbook.md');
  assert.deepEqual(splitSources('A\n\n**Sources:** `products/a.md`, `x.cs`').sources.map(s => s.path), ['products/a.md', 'x.cs']);
  const mid = 'Sources:\n- `a.md`\n\nAnd then more text.';
  assert.deepEqual(splitSources(mid), { body: mid, sources: [] });
  assert.deepEqual(splitSources('No sources here.').sources, []);
  assert.equal(classify('notes/products/Bad Name.md').kind, 'file', 'only real product note names');
});

test('chips are escaped; only notes and settings get buttons', () => {
  const html = sourcesHtml(splitSources('x\n\nSources:\n- `<b>.md`\n- `products/a.md`').sources);
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /data-src-note="products\/a\.md"/);
  assert.match(html, /data-src-wrong="products\/a\.md"/);
  assert.equal(sourcesHtml([]), '');
  assert.match(textHtml('Hi\n\nSources:\n- `settings/products.json`'), /<div class="md"><p>Hi<\/p><\/div><div class="srcs"[^>]*>.*data-src-page="products"/);
});

test('any Folio note a Quick answer cites opens in Folio; a bad product name stays a path (Chat 4.5.0)', () => {
  assert.deepEqual(classify('folio/meetings/platform-sync.md'), { path: 'folio/meetings/platform-sync.md', kind: 'note', note: 'meetings/platform-sync.md' });
  assert.equal(classify('folio/products/Bad Name.md').kind, 'file');
  assert.equal(classify('folio/../secrets.md').kind, 'file');
});
