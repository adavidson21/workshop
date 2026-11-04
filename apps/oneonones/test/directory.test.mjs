// 1:1s and Workshop's people directory (docs/people.md): the Receipts and Queue pickers list its people when it
// exists, reports without a 1:1s person are offered with their links filled in, and without a directory nothing
// changes. Synthetic data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as M from '../js/model.js';
import { homeHtml, personForm, settingsHtml } from '../js/view.js';
import { createOneOnOnes } from '../js/data.js';
import { fakeWs, queueSettings, receiptsPeopleEnv } from './fake.mjs';

const dir = items => ({ schema: 'settings.people', version: 1, rev: 1, items, deleted: {} });
const person = (id, name, relation, extra = {}) => ({ id, updatedAt: 1, name, relation, ...extra });
const DIR = dir([
  person('p_me', 'Engineer A', 'self', { adoIdentity: 'a@example.com' }),
  person('p_r1', 'Dev One', 'report', { adoIdentity: 'Dev.One@example.com' }),
  person('p_r2', 'Dev Two', 'report', { adoIdentity: 'Dev Two (Contractor)' }),
  person('p_r3', 'Dev Three', 'report', { team: false }),
  person('p_gone', 'Dev Gone', 'report', { archived: true }),
  person('p_boss', 'Boss Person', 'manager'),
  person('p_peer', 'Peer Four', 'peer', { team: true }),
]);

test('directoryPeople: null when missing or unreadable, so the old lists are used', () => {
  assert.equal(M.directoryPeople(null), null);
  assert.equal(M.directoryPeople({ ...DIR, version: 2 }), null);
  assert.deepEqual(M.directoryPeople(dir([])), []);
});

test('Receipts picker: directory reports (same ids as Receipts) when it exists, else receipts.people', () => {
  assert.deepEqual(M.receiptsPeople(null, DIR).map(p => [p.id, p.archived]), [['p_gone', true], ['p_r1', false], ['p_r3', false], ['p_r2', false]]);
  const own = M.receiptsPeople(receiptsPeopleEnv([{ id: 'p_old', updatedAt: 1, name: 'Old Report' }]), null);
  assert.ok(own.length > 0, 'falls back to receipts.people');
  assert.deepEqual(M.receiptsPeople(receiptsPeopleEnv([{ id: 'p_old', updatedAt: 1, name: 'Old Report' }]), dir([])), [], 'an empty directory is the list');
});

test('Queue picker: the directory team, keyed the way Queue matches (email, else exact ADO name)', () => {
  assert.deepEqual(M.queuePeople(null, DIR), [
    { key: 'dev.one@example.com', name: 'Dev One' },
    { key: 'Dev Two (Contractor)', name: 'Dev Two' },
    { key: 'a@example.com', name: 'Engineer A' },
    { key: 'Peer Four', name: 'Peer Four' },
  ]);
  assert.ok(M.queuePeople(queueSettings(), null).length > 0, 'falls back to Queue settings');
});

test('a Queue link by name keeps its case (Queue matches names exactly); emails are lowercased', () => {
  assert.equal(M.cleanPerson({ id: 'p_1', links: { queue: 'Dev Two (Contractor)' } }).links.queue, 'Dev Two (Contractor)');
  assert.equal(M.cleanPerson({ id: 'p_1', links: { queue: 'Dev.One@Example.com' } }).links.queue, 'dev.one@example.com');
});

test('suggestions: active directory reports with no 1:1s person (by Receipts link or name)', () => {
  const people = [M.cleanPerson({ id: 'p_x', name: 'Someone', links: { receipts: 'p_r1' } }), M.cleanPerson({ id: 'p_y', name: 'dev two' })];
  assert.deepEqual(M.directorySuggestions(people, DIR).map(p => p.id), ['p_r3']);
  assert.deepEqual(M.directorySuggestions([], null), []);
});

test('personFromDirectory: Receipts by id, Queue if on the team, Docket by name', () => {
  const d = M.directoryPeople(DIR);
  assert.deepEqual(M.personFromDirectory(d.find(p => p.id === 'p_r1'), ['dev one', 'Other']).links, { receipts: 'p_r1', queue: 'dev.one@example.com', docket: 'dev one' });
  assert.deepEqual(M.personFromDirectory(d.find(p => p.id === 'p_r3'), []).links, { receipts: 'p_r3' });
  const p = M.cleanPerson({ id: 'p_new', ...M.personFromDirectory(d.find(x => x.id === 'p_r2'), []) });
  assert.equal(p.links.queue, 'Dev Two (Contractor)', 'survives cleanPerson');
  assert.equal(p.cadenceDays, M.DEFAULT_CADENCE);
});

test('views: suggestions as escaped chips on settings and the empty home; directory hints in the pickers', () => {
  const evil = M.directoryPeople(dir([person('p_bad', '<img src=x onerror=alert(1)>', 'report')]));
  const v = { people: [], settings: { aiDraft: true } };
  const pick = { docket: [], receipts: [], queue: [], fromDirectory: evil, directory: true, states: { docket: 'missing', receipts: 'ok', queue: 'ok' } };
  const s = settingsHtml(v, pick, null), h = homeHtml([], { selected: -1 }, evil);
  for (const html of [s, h]) {
    assert.match(html, /data-add-dir="p_bad"/);
    assert.ok(!html.includes('<img'), 'name is escaped');
  }
  const form = personForm({}, pick);
  assert.match(form, /No direct reports in People yet/);
  assert.match(form, /No one is on your team in People yet/);
});

test('data: the directory is read like the other sources; adding a suggestion links it', async () => {
  const ws = fakeWs({ others: { 'settings.people': DIR } });
  const d = createOneOnOnes(ws);
  await d.loadAll();
  assert.equal(M.directoryPeople(d.v.src.directory).length, 7);
  const added = await d.savePerson(M.personFromDirectory(M.directoryPeople(d.v.src.directory).find(p => p.id === 'p_r1'), []));
  assert.equal(added.links.receipts, 'p_r1');
  assert.deepEqual(M.directorySuggestions(d.v.people, d.v.src.directory).map(p => p.id), ['p_r3', 'p_r2'], 'sorted by name: Dev Three, Dev Two');
});
