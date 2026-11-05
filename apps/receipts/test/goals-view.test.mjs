// Rapport Goals: the HTML and the Markdown renderer's tables and strikethrough. All data here is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/goals/model.js';
import * as V from '../js/goals/view.js';
import { render, inline } from '../js/markdown.js';

const X = '<script>alert(1)</script>';
const noScript = html => assert.ok(!html.includes('<script>'), 'raw <script> in output');

const TEAM = `# Team, Q4 2026\n\n## Make releases boring ${X}\n\n- Cut deploy time ${X}: 40% [at risk]\n  - note ${X}\n- Second: done\n\n## Empty one\n`;
const REPORT = `## Help ${X}\n\nSupports: Make releases boring ${X}\n\n- Do it: 10%\n\n## Side quest\n\nSupports: ${X}\n\n- Thing: 5%\n`;

const tree = () => G.buildTree({
  team: { path: 'goals/team/2026-q4.md', doc: G.parseDoc(TEAM) },
  reports: [
    { person: { id: 'p_1', name: `Dev ${X}`, folder: 'p-1' }, path: 'goals/p-1/2026-q4.md', doc: G.parseDoc(REPORT) },
    { person: { id: 'p_2', name: `Two ${X}`, folder: 'p-2' }, path: 'goals/p-2/2026-q4.md', doc: null }
  ]
});
const treeState = extra => ({
  quarter: '2026-q4', quarters: ['2027-q1', '2026-q4'], current: '2026-q4', tree: tree(), hasTeam: true, teamPath: 'goals/team/2026-q4.md',
  expanded: { has: id => id === 'o:0' || id === 'ua' || id === 's:0:0' }, selected: 'o:0', popover: null, loading: false, ...extra
});

test('tree: escaped, with tree ARIA', () => {
  const html = V.treeHtml(treeState());
  noScript(html);
  assert.match(html, /role="tree"/);
  assert.match(html, /role="treeitem" class="g-item lv1" aria-level="1" aria-expanded="true" aria-selected="true" tabindex="0" data-g-node="o:0"/);
  assert.match(html, /aria-level="2"/);
  assert.match(html, /role="group"/);
  assert.match(html, /Not aligned/);
  assert.match(html, /No goals yet for Q4 2026/);
  assert.match(html, /data-g-start="p-2"/);
  assert.match(html, /Q4 2026 \(this quarter\)/);
  assert.match(html, /<span class="g-bar" aria-hidden="true"><span style="width:70%"><\/span><\/span>/);
  assert.equal((html.match(/tabindex="0"/g) || []).length, 1);
  // The second objective has no KRs and no supporters: a leaf, no aria-expanded.
  assert.match(html, /aria-level="1" aria-selected="false" tabindex="-1" data-g-node="o:1"/);
});

test('tree: empty states and loading', () => {
  const none = V.treeHtml(treeState({ hasTeam: false, tree: G.buildTree({ team: null, reports: [] }) }));
  assert.match(none, /No team goals for Q4 2026 yet\./);
  assert.match(none, /data-g-start="team"/);
  assert.match(V.treeHtml(treeState({ loading: true })), /Loading goals\./);
});

test('KR row and popover', () => {
  const kr = G.parseDoc(TEAM).objectives[0].krs[0];
  const row = V.krRowHtml(kr, { path: 'goals/team/2026-q4.md', editable: true, popover: { path: 'goals/team/2026-q4.md', line: kr.line } });
  noScript(row);
  assert.match(row, /data-g-kr-form/);
  assert.match(row, /value="40%"/);
  assert.match(row, /<option value="at risk" selected>/);
  assert.match(row, /g-st g-st-at-risk/);
  assert.equal(V.statusChip(''), '');
  assert.equal(V.bar(null), '');
  assert.equal(V.rollupLabel({ pct: 0.5, measured: 1, total: 2 }), '50% (1 of 2 measured)');
  assert.equal(V.rollupLabel({ pct: null, measured: 0, total: 2 }), 'no KRs measured');
});

test('doc: preview, edit, split, empty and supports menu', () => {
  const file = { path: 'goals/p-1/2026-q4.md', text: REPORT, mtime: 1, dirty: false, saving: false, error: '', conflict: null, exists: true };
  const base = { owner: 'p-1', ownerName: `Dev ${X}`, quarter: '2026-q4', isReport: true, file, doc: G.parseDoc(REPORT), teamTitles: [`Make releases boring ${X}`], popover: null, menu: null, formatOpen: false, canCopy: false, loading: false };
  const pv = V.docHtml({ ...base, mode: 'preview' });
  noScript(pv);
  assert.match(pv, /Supports: <b>Make releases boring &lt;script&gt;/);
  assert.match(pv, /data-g-sup-open="0"/);
  assert.match(pv, /no team objective by that name/); // the second one
  const ed = V.docHtml({ ...base, mode: 'edit' });
  noScript(ed);
  assert.match(ed, /data-g-editor/);
  assert.match(ed, /Format/);
  assert.match(V.docHtml({ ...base, mode: 'split' }), /g-split/);
  const menu = V.docHtml({ ...base, mode: 'preview', menu: 0 });
  noScript(menu);
  assert.match(menu, /role="menu"/);
  assert.match(menu, /data-g-sup="">Not aligned/);
  const empty = V.docHtml({ ...base, mode: 'edit', file: { ...file, exists: false }, canCopy: true });
  assert.match(empty, /Start from the template/);
  assert.match(empty, /Copy from last quarter/);
  const conflict = V.docHtml({ ...base, mode: 'edit', file: { ...file, conflict: { current: null } } });
  assert.match(conflict, /Load the new version/);
  assert.match(conflict, /Overwrite with mine/);
});

test('renderer: pipe tables', () => {
  const html = render('| Left | Right | Mid |\n|:--|--:|:-:|\n| `a|b` | **x** | [l](https://example.com) |\n| <b>raw</b> |\n');
  assert.match(html, /<div class="md-table"><table>/);
  assert.match(html, /<th style="text-align:left">Left<\/th><th style="text-align:right">Right<\/th><th style="text-align:center">Mid<\/th>/);
  assert.match(html, /<td style="text-align:left"><code>a\|b<\/code><\/td>/);
  assert.match(html, /<strong>x<\/strong>/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /&lt;b&gt;raw&lt;\/b&gt;/);
  assert.equal((html.match(/<tr>/g) || []).length, 3);
  assert.match(render('a | b\nnot a separator'), /^<p>a \| b not a separator<\/p>$/);
  assert.match(render('| a | b |\n|---|\n'), /<p>/); // column count must match
});

test('renderer: strikethrough, escaping and links unchanged', () => {
  assert.equal(inline('~~gone~~ and ~ alone'), '<del>gone</del> and ~ alone');
  assert.equal(inline('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');
  assert.equal(inline('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
  assert.ok(!render('![i](https://example.com/a.png)').includes('<img'));
});
