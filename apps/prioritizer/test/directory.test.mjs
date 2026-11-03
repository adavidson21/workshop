// Workshop's people directory in Docket (directory-model.js; docs/people.md in the workshop repo):
// read only, suggestions, links from Docket people to directory people, and the Reports team fill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDirectory, suggestions, linkPeople, teamLines } from '../js/directory-model.js';
import { MAIN_LIST, applyEnvelope, envelopeFromBoard } from '../js/store-format.js';

const env = items => ({ schema: 'settings.people', version: 1, rev: 1, items, deleted: {} });
const DIR = readDirectory(env([
  { id: 'p_me', updatedAt: 1, name: 'Engineer A', relation: 'self', adoIdentity: 'a@example.com' },
  { id: 'p_r1', updatedAt: 1, name: 'Dev One', relation: 'report', adoIdentity: 'dev.one@example.com' },
  { id: 'p_r2', updatedAt: 1, name: 'Dev Two', relation: 'report' },
  { id: 'p_gone', updatedAt: 1, name: 'Dev Gone', relation: 'report', archived: true },
  { id: 'p_boss', updatedAt: 1, name: 'Boss Person', relation: 'manager' },
  { id: 'p_peer', updatedAt: 1, name: 'Peer Three', relation: 'peer', team: true },
]));

test('readDirectory: null when missing or unreadable', () => {
  assert.equal(readDirectory(null), null);
  assert.equal(readDirectory({ ...env([]), version: 2 }), null);
  assert.equal(readDirectory({ ...env([]), schema: 'prioritizer.people' }), null);
  assert.deepEqual(readDirectory(env([])), []);
});

test('suggestions: active names Docket does not have yet, not you', () => {
  assert.deepEqual(suggestions(['dev one', 'Vendor Team'], DIR), ['Dev Two', 'Boss Person', 'Peer Three']);
  assert.deepEqual(suggestions(['Dev One'], null), []);
});

test('linkPeople: links by name ignoring case, keeps old links, reports changes', () => {
  const board = { people: ['dev one', 'Vendor Team'], personLinks: { 'someone renamed': 'p_x' } };
  assert.equal(linkPeople(board, DIR), true);
  assert.deepEqual(board.personLinks, { 'someone renamed': 'p_x', 'dev one': 'p_r1' });
  assert.equal(linkPeople(board, DIR), false);
  assert.equal(linkPeople({ people: ['Dev One'] }, null), false);
});

test('personId round trips through prioritizer.people, which stays v1', () => {
  const board = { lists: [{ id: MAIN_LIST, name: 'Main', parentId: null }], tasks: [], people: ['Dev One', 'Vendor Team'], capacity: 20, ado: {} };
  linkPeople(board, DIR);
  const e = envelopeFromBoard('people', board, null, []);
  assert.equal(e.version, 1);
  assert.deepEqual(e.items.map(p => [p.id, p.name, p.personId]), [['dev one', 'Dev One', 'p_r1'], ['vendor team', 'Vendor Team', undefined]]);
  assert.ok(!('personId' in e.items[1]));
  const back = { lists: board.lists, tasks: [], people: [] };
  applyEnvelope('people', e, back);
  assert.deepEqual(back.people, ['Dev One', 'Vendor Team']);
  assert.deepEqual(back.personLinks, { 'dev one': 'p_r1' });
});

test('a v1 people file without personId still loads', () => {
  const back = { lists: [], tasks: [], people: [] };
  applyEnvelope('people', { schema: 'prioritizer.people', version: 1, rev: 1, items: [{ id: 'dev one', updatedAt: 1, name: 'Dev One' }], deleted: {} }, back);
  assert.deepEqual(back.people, ['Dev One']);
  assert.deepEqual(back.personLinks, {});
});

test('teamLines: ADO email or name for active team people', () => {
  assert.deepEqual(teamLines(DIR), ['a@example.com', 'dev.one@example.com', 'Dev Two', 'Peer Three']);
  assert.deepEqual(teamLines(null), []);
});
