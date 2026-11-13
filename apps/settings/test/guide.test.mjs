import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GUIDE, SECTIONS, APP_NAMES, matches } from '../js/guide.js';
import { PAGES, GROUPS } from '../js/pages.js';

test('the guide is a page in the Help group', () => {
  assert.equal(PAGES.guide.group, 'help');
  assert.ok(GROUPS.some(g => g.id === 'help'));
});

test('every scenario is complete, in a known section, and opens a known app', () => {
  const ids = new Set();
  for (const s of GUIDE) {
    assert.ok(!ids.has(s.id), s.id); ids.add(s.id);
    assert.ok(SECTIONS.some(x => x.id === s.section), s.id);
    assert.ok(s.ask && s.why && s.steps.length >= 2, s.id);
    assert.ok(s.app === '' || APP_NAMES[s.app], s.id);
  }
  for (const id of ['goal-to-stories', 'simple-ask']) assert.ok(ids.has(id));
});

test('no em dashes anywhere in the guide', () => {
  assert.ok(!readFileSync(new URL('../js/guide.js', import.meta.url), 'utf8').includes('—'));
});

test('search matches every word, in the ask, steps, app or other ways', () => {
  const goal = GUIDE.find(s => s.id === 'goal-to-stories');
  assert.ok(matches(goal, ''));
  assert.ok(matches(goal, 'user stories'));
  assert.ok(matches(goal, 'loom epic'));
  assert.ok(!matches(goal, 'stories nightly'));
  assert.ok(matches(GUIDE.find(s => s.id === 'simple-ask'), 'quick change'));
});
