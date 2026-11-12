// Who a task is for, from Workshop's people directory (directory-model.js; docs/people.md in the workshop repo):
// ids, @handles, groups and the People view's cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardsFor, involves, mentionOf, namesOf, others, refOf, resolve, via } from '../js/directory-model.js';
import { directory } from '../../../shared/people.js';

const DIR = directory({ schema: 'settings.people', version: 2, rev: 1, deleted: {}, items: [
  { id: 'p_me', kind: 'person', updatedAt: 1, name: 'Engineer A', handle: 'engineer', relation: 'self' },
  { id: 'p_r1', kind: 'person', updatedAt: 1, name: 'Dev One', handle: 'dev', relation: 'report', adoIdentity: 'dev.one@example.com' },
  { id: 'p_john', kind: 'person', updatedAt: 1, name: 'John Smith', handle: 'john', relation: 'peer' },
  { id: 'p_gone', kind: 'person', updatedAt: 1, name: 'Dev Gone', handle: 'gone', relation: 'report', archived: true },
  { id: 'p_v', kind: 'person', updatedAt: 1, name: 'Vendor Rep', handle: 'vendor', relation: 'contact' },
  { id: 'g_lead', kind: 'group', updatedAt: 1, name: 'Leadership', handle: 'leadership', members: ['p_john', 'p_r1'] }
] });
const task = (id, who, extra = {}) => ({ id, title: id, who, done: false, rank: 1, ...extra });

test('refOf: ids stay ids, then handles, names and ADO identities', () => {
  assert.equal(refOf('@leadership', DIR), 'g_lead');
  assert.equal(refOf('john smith', DIR), 'p_john');
  assert.equal(refOf('DEV.ONE@example.com', DIR), 'p_r1');
  assert.equal(refOf('p_unknown', DIR), 'p_unknown', 'an id the directory lost is kept');
  assert.equal(refOf('@gone', DIR), null, 'archived people are not matched');
  assert.equal(refOf('', DIR), null);
});

test('resolve: known ids now, new names to add (capitalized, once each)', () => {
  assert.deepEqual(resolve(['@john', 'g_lead', '@john', '@newbie', 'newbie', ' '], DIR), { ids: ['p_john', 'g_lead'], missing: ['Newbie'] });
});

test('involves and via: directly or through an active group', () => {
  const t = task('t1', ['g_lead']);
  assert.equal(involves(t, 'p_john', DIR), true);
  assert.equal(via(t, 'p_john', DIR), 'g_lead');
  assert.equal(via(task('t2', ['p_john']), 'p_john', DIR), 'direct');
  assert.equal(involves(t, 'p_v', DIR), false);
});

test('names and mentions for display and editing', () => {
  assert.deepEqual(namesOf(['p_john', 'g_lead', 'p_x'], DIR), ['John Smith', 'Leadership', 'Unknown']);
  assert.equal(mentionOf('g_lead', DIR), '@leadership');
  assert.equal(mentionOf('p_x', DIR), 'p_x');
});

test('cardsFor: people and groups with something open, plus your team; others are everyone else', () => {
  const tasks = [task('a', ['g_lead']), task('b', ['p_v'], { done: true })];
  assert.deepEqual(cardsFor(tasks, DIR).map(it => it.id), ['p_r1', 'p_john', 'g_lead'], 'reports are on your team; John through the group');
  assert.deepEqual(others(tasks, DIR).map(it => it.id), ['p_v']);
});
