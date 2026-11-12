// 1:1s and Workshop's people directory (docs/people.md): everyone you meet with is a directory person; reports
// and your manager without a 1:1s person are offered in one click. Synthetic data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as M from '../js/oneonones/model.js';
import { homeHtml, personForm, settingsHtml } from '../js/oneonones/view.js';
import { createOneOnOnes } from '../js/oneonones/data.js';
import { DIR, fakeWs } from './oneonones-fake.mjs';
import { directory } from '../../../shared/people.js';

test('suggestions: active reports and your manager with no 1:1s person', () => {
  const people = [M.cleanPerson({ id: 'p_x', name: 'Someone', personId: 'p_r1' })];
  assert.deepEqual(M.directorySuggestions(people, DIR).map(p => p.id), ['p_mgr']);
  assert.deepEqual(M.directorySuggestions([], null), []);
});

test('personFromDirectory: linked by id, default cadence', () => {
  const p = M.cleanPerson({ id: 'p_new', ...M.personFromDirectory(DIR.byId.get('p_peer')) });
  assert.deepEqual(p, { id: 'p_new', personId: 'p_peer', name: 'Peer Three', cadenceDays: M.DEFAULT_CADENCE, archived: false });
});

test('views: suggestions as escaped chips; the form picks from People and names an unknown link', () => {
  const evil = directory({ schema: 'settings.people', version: 2, rev: 1, items: [{ id: 'p_bad', kind: 'person', updatedAt: 1, name: '<img src=x onerror=alert(1)>', handle: 'bad', relation: 'report' }] });
  const sugg = M.directorySuggestions([], evil);
  const v = { people: [], settings: { aiDraft: true } };
  const pick = { choices: M.directoryChoices(evil), fromDirectory: sugg, embedded: true };
  const s = settingsHtml(v, pick, null), h = homeHtml([], { selected: -1 }, sugg);
  for (const html of [s, h]) {
    assert.match(html, /data-add-dir="p_bad"/);
    assert.ok(!html.includes('<img'), 'name is escaped');
  }
  assert.match(personForm({}, { choices: [], fromDirectory: [], embedded: true }), /No one in People yet/);
  assert.match(personForm({ id: 'p_1', personId: 'p_lost', name: 'Old Peer' }, pick), /Old Peer \(not in People\)/);
  assert.match(personForm({ id: 'p_1', personId: 'p_bad' }, pick), /value="p_bad" selected/);
});

test('data: the directory is handed in by main.js; adding a suggestion links it', async () => {
  const ws = fakeWs();
  const d = createOneOnOnes(ws);
  await d.loadAll();
  d.setOwn(null, DIR);
  const added = await d.savePerson(M.personFromDirectory(DIR.byId.get('p_r1')));
  assert.equal(added.personId, 'p_r1');
  assert.deepEqual(M.directorySuggestions(d.v.people, d.v.dir).map(p => p.id), ['p_mgr']);
  assert.equal(ws.puts.includes('people'), false, 'the directory is never written here');
});
