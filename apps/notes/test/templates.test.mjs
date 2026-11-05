import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTERS, dailyPath, dailyText, dayOf, fill, isDay, missingStarters, templatesIn } from '../js/templates.js';
import { SEG } from '../js/model.js';

test('templates are the notes directly under templates/', () => {
  const t = templatesIn(['templates/retro.md', 'templates/adr.md', 'templates/old/x.md', 'retro.md', 'templates/pic.png']);
  assert.deepEqual(t, [{ path: 'templates/adr.md', name: 'adr' }, { path: 'templates/retro.md', name: 'retro' }]);
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
