// People's spreadsheet template and import planning (js/sheet.js), against the directory's own rules.
// Run: node --test "apps/*/test/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../js/sheet.js';
import * as P from '../../../shared/people.js';

const NOW = 1793736000000;
function dirOf(inputs) {
  const items = [];
  for (const x of inputs) items.push(P.create(x, items, NOW));
  return P.directory({ ...P.blank(), items });
}

test('template: header only for an empty directory, a row per active person otherwise', () => {
  assert.deepEqual(S.rows(P.EMPTY), [S.COLUMNS]);
  const d = dirOf([{ name: 'Person One', relation: 'self' }, { name: 'Dev Two', relation: 'report', adoIdentity: 'dev@example.com' }]);
  const g = P.create({ kind: 'group', name: 'Leads', members: [d.people[1].id] }, d.items, NOW);
  const d2 = P.directory({ ...P.blank(), items: [...d.items, g] });
  assert.deepEqual(S.rows(d2).slice(1), [
    ['Person One', 'person', 'You', 'Yes', '', '', '', ''],
    ['Dev Two', 'dev', 'Direct report', 'Yes', 'dev@example.com', '', '', '@leads']
  ]);
});

test('parse: headers in any order and case, blank rows skipped, values normalized', () => {
  const rows = S.parse([
    [],
    ['role', 'NAME', 'on my team', 'Relation', 'groups', 'azure devops', 'Handle'],
    ['Lead', 'Ana Lee', 'no', 'Direct Report', '@Leadership, platform', 'ana@example.com', '@Ana'],
    ['', '', '', '', '', '', ''],
    ['', 'Bo Kim', '', '', '', '', '']
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual({ ...rows[0] }, { line: 3, name: 'Ana Lee', handle: 'ana', relation: 'report', team: false, adoIdentity: 'ana@example.com', role: 'Lead', owns: [], groups: ['leadership', 'platform'], why: '' });
  assert.equal(rows[1].relation, '');
  assert.equal(rows[1].team, null);
});

test('parse: says what is wrong with a row, and refuses a sheet without a Name column', () => {
  const rows = S.parse([['Name', 'Relation', 'On my team'], ['A', 'Boss', ''], ['B', '', 'maybe'], ['', 'Peer', '']]);
  assert.match(rows[0].why, /Relation "Boss"/);
  assert.match(rows[1].why, /Yes or No/);
  assert.equal(rows[2].why, 'No name.');
  assert.throws(() => S.parse([['Who'], ['A']]), /no Name column/);
  assert.throws(() => S.parse([]), /empty/);
});

test('plan: adds new people, updates matches by handle or name, leaves blanks alone', () => {
  const d = dirOf([{ name: 'Person One', relation: 'self' }, { name: 'Dev Two', relation: 'report', role: 'Engineer', adoIdentity: 'dev@example.com' }]);
  const pl = S.plan(d, S.parse([
    ['Name', 'Handle', 'Relation', 'Role', 'Azure DevOps'],
    ['Person One', '', '', '', ''],          // same, matched by name
    ['Dev Two', 'dev', '', 'Senior engineer', ''], // update role only
    ['New Peer', '', 'Peer', '', 'np@example.com']
  ]));
  assert.deepEqual(pl.rows.map(r => r.action), ['same', 'update', 'new']);
  assert.deepEqual(pl.rows[1].changes, ['role']);
  assert.equal(pl.rows[2].fields.handle, 'new');
  assert.equal(pl.rows[2].fields.team, false);
  assert.deepEqual(pl.counts, { new: 1, update: 1, same: 1, skip: 0 });
  const changes = S.peopleChanges(pl);
  assert.equal(changes.length, 2);
  assert.equal(changes[0].id, d.people[1].id);
  assert.equal(changes[1].kind, 'person');
});

test('plan: the directory rules run row by row (one you, one manager, unique handles, no repeats)', () => {
  const d0 = dirOf([{ name: 'Person One', relation: 'self' }]);
  const d = P.directory({ ...P.blank(), items: [...d0.items, P.create({ kind: 'group', name: 'Leads' }, d0.items, NOW)] });
  const pl = S.plan(d, S.parse([
    ['Name', 'Relation', 'Handle'],
    ['Another Me', 'You', ''],
    ['Boss A', 'Manager', ''],
    ['Boss B', 'Manager', ''],
    ['Sam One', '', 'leads'],
    ['Person One', '', ''],
    ['person one', '', ''],
    ['P. One', '', 'person']
  ]));
  assert.deepEqual(pl.rows.map(r => r.action), ['skip', 'new', 'skip', 'skip', 'same', 'skip', 'skip']);
  assert.match(pl.rows[0].why, /already you/);
  assert.match(pl.rows[2].why, /already your manager/);
  assert.match(pl.rows[3].why, /already Leads/);
  assert.match(pl.rows[5].why, /earlier row/);
  assert.match(pl.rows[6].why, /earlier row/); // the handle names the same person as row 6
});

test('plan and groupChanges: new groups are made, existing ones only gain members', () => {
  const d = dirOf([{ name: 'Person One', relation: 'self' }, { name: 'Dev Two', relation: 'report' }]);
  const g = P.create({ kind: 'group', name: 'Leadership', members: [d.people[0].id] }, d.items, NOW);
  const d2 = P.directory({ ...P.blank(), items: [...d.items, g] });
  const pl = S.plan(d2, S.parse([['Name', 'Groups'], ['Dev Two', '@leadership @platform-team'], ['Ana Lee', 'platform-team'], ['Bo', '@dev']]));
  assert.deepEqual(pl.rows.map(r => r.action), ['update', 'new', 'new']);
  assert.deepEqual(pl.rows[0].changes, ['joins @leadership', 'joins @platform-team']);
  assert.equal(pl.rows[0].fields, null);
  assert.deepEqual(pl.groups, ['platform-team']);
  assert.match(pl.rows[2].why, /@dev is Dev Two, not a group/);
  const ids = new Map([[pl.rows[1].id, 'p_saved1'], [pl.rows[2].id, 'p_saved2']]);
  const gc = S.groupChanges(d2, pl, ids);
  assert.deepEqual(gc, [
    { id: g.id, members: [d.people[0].id, d.people[1].id] },
    { kind: 'group', name: 'Platform team', handle: 'platform-team', members: [d.people[1].id, 'p_saved1'] }
  ]);
});

test('a filled-in template imports back with no changes', () => {
  const d = dirOf([{ name: 'Person One', relation: 'self' }, { name: 'Dev Two', relation: 'report', adoIdentity: 'dev@example.com', role: 'Engineer' }, { name: 'Vendor Sam', relation: 'contact' }]);
  const pl = S.plan(d, S.parse(S.rows(d)));
  assert.deepEqual(pl.counts, { new: 0, update: 0, same: 3, skip: 0 });
});

test('app.json lists every script, and nothing mentions a Since date', () => {
  const app = JSON.parse(fs.readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  for (const f of ['js/main.js', 'js/forms.js', 'js/sheet.js', 'people.css']) assert.ok(app.files.includes(f), f);
  for (const f of ['js/main.js', 'js/forms.js', 'js/sheet.js']) assert.doesNotMatch(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'), /since/i, f);
});

test('Owns: a comma list in the sheet, kept on the person, and an import that changes it says so', () => {
  const rows = S.parse([['Name', 'Owns'], ['Ana Lee', 'Lighthouse, web-app; lighthouse']]);
  assert.deepEqual(rows[0].owns, ['Lighthouse', 'web-app']);
  const d = dirOf([{ name: 'Ana Lee', relation: 'report' }]);
  const out = S.plan(d, rows);
  assert.equal(out.rows[0].action, 'update');
  assert.deepEqual(out.rows[0].changes, ['owns']);
  const same = S.plan(d, S.parse([['Name', 'Owns'], ['Ana Lee', '']]));
  assert.equal(same.rows[0].action, 'same', 'an empty cell leaves what is there');
});
