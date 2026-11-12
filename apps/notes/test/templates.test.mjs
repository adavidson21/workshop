import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTERS, dailyPath, dailyText, dayOf, fill, isDay, missingStarters, templateInfo, templatesIn } from '../js/templates.js';
import { SEG, buildIndex } from '../js/model.js';

test('templates are the notes directly under templates/, named for what they are', () => {
  const t = templatesIn(['templates/retro.md', 'templates/adr.md', 'templates/old/x.md', 'retro.md', 'templates/pic.png']);
  assert.deepEqual(t.map(x => [x.path, x.name]), [['templates/adr.md', 'Decision record (ADR)'], ['templates/retro.md', 'Retro']]);
  assert.ok(t.every(x => x.use.length > 0));
});

test('a template is named by its frontmatter, the starter set, or its file name', () => {
  assert.deepEqual(templateInfo('templates/team-sync.md', '# {{title}}\n'), { name: 'Team sync', use: '' });
  assert.deepEqual(templateInfo('templates/meeting.md', '---\ntemplate: Staff meeting\ndescription: Weekly staff.\n---\n# {{title}}\n'),
    { name: 'Staff meeting', use: 'Weekly staff.' });
  assert.equal(templateInfo('templates/daily.md', '# {{date}}\n').name, 'Daily note');
  for (const p of Object.keys(STARTERS)) assert.ok(templateInfo(p, STARTERS[p]).use, p);
});

test('fill leaves out the template name and description, and keeps other frontmatter', () => {
  const at = new Date(2026, 10, 5, 9, 7);
  assert.equal(fill('---\ntemplate: Sync\ndescription: For syncs.\n---\n# {{title}}\n', { title: 'A', now: at }), '# A\n');
  assert.equal(fill('---\ntemplate: Sync\ntags: [x]\n---\n# {{title}}\n', { title: 'A', now: at }), '---\ntags: [x]\n---\n# A\n');
});

test('the index shows a template by its name, not its {{title}} heading', () => {
  const idx = buildIndex([{ path: 'templates/meeting.md', content: STARTERS['templates/meeting.md'] }, { path: 'notes-a.md', content: '# Real\n' }]);
  assert.equal(idx.notes.get('templates/meeting.md').title, 'Meeting notes');
  assert.match(idx.notes.get('templates/meeting.md').use, /meeting/i);
  assert.equal(idx.notes.get('notes-a.md').title, 'Real');
  assert.equal(idx.notes.get('notes-a.md').use, undefined);
});

test('fill puts in the title, date and time and leaves other {{names}}', () => {
  const at = new Date(2026, 10, 5, 9, 7);
  assert.equal(fill('# {{title}}\n{{ date }} {{time}} {{who}}', { title: 'Sync', now: at }), '# Sync\n2026-11-05 09:07 {{who}}');
  assert.equal(dayOf(at), '2026-11-05');
});

test('the daily note: daily/<date>.md, from the daily template', () => {
  assert.equal(dailyPath('2026-11-05'), 'daily/2026-11-05.md');
  assert.ok(SEG.test('2026-11-05'));
  assert.throws(() => dailyPath('11/05/2026'), RangeError);
  assert.equal(isDay('2026-02-30'), true); // Date.parse rolls over; the path is still well formed
  assert.match(dailyText('2026-11-05'), /^# 2026-11-05\n/);
  assert.equal(dailyText('2026-11-05', '# Day {{date}}\n'), '# Day 2026-11-05\n');
});

test('starter templates: names follow the rules, no 1:1 template, and only the missing ones are added', () => {
  for (const p of Object.keys(STARTERS)) assert.match(p, /^templates\/[a-z0-9-]+\.md$/);
  assert.equal(Object.keys(STARTERS).some(p => /1-1|one-on-one|1on1/.test(p)), false);
  const left = missingStarters(new Set(['templates/adr.md']));
  assert.equal(left.length, Object.keys(STARTERS).length - 1);
  assert.equal(left.some(t => t.path === 'templates/adr.md'), false);
});
