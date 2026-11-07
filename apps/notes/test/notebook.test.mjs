// Notebook 3.0: sections, the Tandem section's pure parts, small edits, templates and the preview's tasks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collapseTitle, taskText, titleEmpty, toggleTask } from '../js/edits.js';
import { dailyGroups, notesPaths, sectionOf, visibleSections } from '../js/sections.js';
import { docName, findDoc, groupItems, isTandem, itemLabel, parseTandem, tandemPath, createTandem } from '../js/tandem.js';
import { PLACEHOLDERS, STARTERS, asTemplate, placeholdersFor, setTemplateFields, templateFields, templateText, templatesIn, fill } from '../js/templates.js';
import { placeholderChips, render } from '../js/markdown.js';

test('toggleTask flips only that line; taskText reads it', () => {
  const t = '# Day\n\n- [ ] Follow up with Jo\n- Shipped #win\n  1. [x] Nested done';
  assert.equal(toggleTask(t, 2), '# Day\n\n- [x] Follow up with Jo\n- Shipped #win\n  1. [x] Nested done');
  assert.equal(toggleTask(t, 4).split('\n')[4], '  1. [ ] Nested done');
  assert.equal(toggleTask(t, 3), null);
  assert.equal(toggleTask(t, 99), null);
  assert.equal(taskText(t, 2), 'Follow up with Jo');
  assert.equal(taskText(t, 3), null);
});

test('collapseTitle turns "# # Title" into "# Title"; titleEmpty for the hint', () => {
  assert.deepEqual(collapseTitle('# # Deploy plan\n\n'), { text: '# Deploy plan\n\n', shift: 2 });
  assert.equal(collapseTitle('# #ops notes').shift, null, 'a title starting with a tag stays');
  assert.deepEqual(collapseTitle('# ## x'), { text: '# x', shift: 3 });
  assert.equal(collapseTitle('# Deploy #ops').shift, null);
  assert.equal(collapseTitle('#ops # not a title').shift, null);
  assert.ok(titleEmpty('# \n\n'));
  assert.ok(titleEmpty('#'));
  assert.ok(!titleEmpty('# T'));
});

test('sections: which section a page is in, daily by month, and the Notes tree paths', () => {
  assert.equal(sectionOf('runbooks/deploy.md'), 'notes');
  assert.equal(sectionOf('daily.md'), 'notes', 'a note named daily is still a note');
  assert.equal(sectionOf('daily/2026-11-06.md'), 'daily');
  assert.equal(sectionOf('products/wiki-edge.md'), 'products');
  assert.equal(sectionOf('templates/meeting.md'), 'templates');
  assert.equal(sectionOf('tandem:41207-x/plan.md'), 'tandem');
  assert.deepEqual(notesPaths(['a.md', 'daily/2026-11-06.md', 'products/x.md', 'templates/m.md', 'f/b.md']), ['a.md', 'f/b.md']);
  assert.deepEqual(visibleSections().map(s => s.id), ['notes', 'daily', 'products', 'templates']);
  assert.ok(visibleSections({ tandem: true }).some(s => s.id === 'tandem'));
  const g = dailyGroups(['daily/2026-10-30.md', 'daily/2026-11-06.md', 'daily/2026-11-02.md', 'daily/notes.md', 'x.md']);
  assert.deepEqual(g.map(x => x.month), ['November 2026', 'October 2026']);
  assert.deepEqual(g[0].days.map(d => d.label), ['Fri 6', 'Mon 2']);
});

test('Tandem paths, names and grouping', () => {
  assert.equal(tandemPath('41207-fix', 'plan.md'), 'tandem:41207-fix/plan.md');
  assert.ok(isTandem('tandem:41207-fix/plan.md'));
  assert.ok(!isTandem('tandem/plan.md'));
  assert.deepEqual(parseTandem('tandem:41207-fix/plan.md'), { folder: '41207-fix', file: 'plan.md' });
  assert.deepEqual(parseTandem('41207-fix/plan.md'), { folder: '41207-fix', file: 'plan.md' });
  for (const bad of ['../x/plan.md', 'tandem:a/../b.md', 'tandem:.work/x.md', 'tandem:a/plan.txt', 'tandem:a/b/c.md']) assert.equal(parseTandem(bad), null, bad);
  assert.equal(docName('plan.md'), 'Plan');
  assert.equal(docName('rollout-notes.md'), 'Rollout notes');
  assert.equal(itemLabel({ kind: 'item', id: '41207', title: 'Fix login' }), '#41207 Fix login');
  assert.equal(itemLabel({ kind: 'spike', title: 'Cache' }), 'Spike: Cache');
  const items = [{ folder: 'a', review: null, files: [{ file: 'plan.md' }] }, { folder: 'b', review: 'spec.md', files: [{ file: 'spec.md' }] }];
  assert.deepEqual(groupItems(items).review.map(i => i.folder), ['b']);
  assert.equal(findDoc(items, 'tandem:b/spec.md').file.file, 'spec.md');
  assert.equal(findDoc(items, 'tandem:c/spec.md'), null);
});

test('createTandem stays hidden without Workshop on this computer, and saves with the text read', async () => {
  const off = createTandem({ backend: 'browser', connectors: { call: async () => { throw new Error('unavailable'); } } });
  assert.equal((await off.refresh()).available, false);
  const calls = [];
  const ws = { backend: 'agent', connectors: {
    on() {}, onStatus() {},
    async call(id, action, args, opts) {
      calls.push([action, args, opts]);
      if (action === 'docs.list') return { items: [{ folder: 'a', busy: 'Tandem is working on this item', review: null, files: [{ file: 'plan.md' }] }] };
      if (action === 'file.read') return { text: '# Plan' };
      return { ok: true };
    } } };
  const t = createTandem(ws);
  const st = await t.refresh();
  assert.equal(st.available, true);
  assert.equal(t.busy('tandem:a/plan.md'), 'Tandem is working on this item');
  assert.equal(await t.read('tandem:a/plan.md'), '# Plan');
  await t.save('tandem:a/plan.md', '# Plan 2', '# Plan');
  assert.deepEqual(calls.find(c => c[0] === 'file.write'), ['file.write', { folder: 'a', file: 'plan.md', text: '# Plan 2', expected: '# Plan' }, { confirm: true }]);
});

test('templates: starters always offered, file wins; text, fields, placeholders and Save as template', () => {
  const list = templatesIn(['templates/meeting.md', 'notes.md'], () => '---\ntemplate: Standup\n---\n# {{title}}', { starters: true });
  const meeting = list.find(t => t.path === 'templates/meeting.md');
  assert.equal(meeting.name, 'Standup');
  assert.equal(meeting.builtIn, false);
  assert.ok(list.find(t => t.path === 'templates/retro.md').builtIn);
  assert.equal(list.length, Object.keys(STARTERS).length);
  assert.equal(templatesIn(['templates/meeting.md']).length, 1, 'without starters: files only');
  assert.equal(templateText('templates/retro.md', () => null), STARTERS['templates/retro.md']);
  assert.equal(templateText('templates/retro.md', () => 'mine'), 'mine');
  assert.equal(templateText('templates/nope.md', () => null), null);
  const t = setTemplateFields('# {{title}}\n', { name: 'Interview', description: 'Candidate\nloop' });
  assert.equal(t, '---\ntemplate: Interview\ndescription: Candidate loop\n---\n# {{title}}\n');
  assert.deepEqual(templateFields(t), { name: 'Interview', description: 'Candidate loop' });
  assert.equal(setTemplateFields(t, { name: '', description: '' }), '# {{title}}\n');
  assert.equal(setTemplateFields('---\ntags: [a]\n---\nx', { name: 'N' }), '---\ntemplate: N\ntags: [a]\n---\nx');
  const tpl = asTemplate('# Sprint 14 retro\n\n## Went well\n', 'Retro (team)');
  assert.equal(tpl, '---\ntemplate: Retro (team)\n---\n# {{title}}\n\n## Went well\n');
  assert.equal(fill(tpl, { title: 'Sprint 15' }), '# Sprint 15\n\n## Went well\n');
  assert.deepEqual(placeholdersFor('templates/meeting.md'), ['title', 'date', 'time', 'slug']);
  assert.ok(placeholdersFor('templates/daily.md').includes('docket'));
});

test('preview: clickable task boxes with their line, plain bullets keep their marker, placeholder chips', () => {
  const html = render('- [ ] Follow up\n- Shipped #win', { tasks: true });
  assert.match(html, /<li data-line="0" class="task"><input type="checkbox" data-task="0" aria-label="Done"> Follow up<\/li>/);
  assert.match(html, /<li data-line="1">Shipped/, 'the plain bullet is not a task row');
  assert.match(render('- [x] Done'), /<input type="checkbox" disabled checked>/);
  const ph = render('# {{title}}\n\n[x]({{slug}}.md) `{{date}}` {{date}} {{nope}}', { placeholders: PLACEHOLDERS });
  assert.match(ph, /<h1[^>]*><span class="ph" title="[^"]+">title<\/span><\/h1>/);
  assert.ok(!/href="[^"]*<span/.test(ph), 'never inside an attribute');
  assert.match(ph, /\{\{nope\}\}/);
  assert.equal(placeholderChips('<a title="{{title}}">{{title}}</a>', { title: 'T' }), '<a title="{{title}}"><span class="ph" title="T">title</span></a>');
});
