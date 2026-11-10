import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../teams.js';
import { SchemaSet } from '../../tests/lib/schema.mjs';

test('teams: area paths from the form, one per line, no blanks or repeats', () => {
  assert.deepEqual(T.parseAreas(' Project\\Team \n\nproject\\team\nProject\\Other\r\n'), ['Project\\Team', 'Project\\Other']);
  assert.equal(T.parseAreas(Array.from({ length: 30 }, (_, i) => 'A' + i).join('\n')).length, T.MAX_AREAS);
});

test('teams: your team in and out of the envelope, matching docs/teams.md', () => {
  assert.deepEqual(T.mine(null), { name: 'My team', areas: [], connection: '', areaConnections: {} });
  const items = T.withMine([{ id: 't_other', name: 'Other', areas: ['X'] }], { areas: 'Project\\Team', connection: ' work ' });
  assert.deepEqual(items.map(i => i.id), ['t_other', 't_mine']);
  const env = { ...T.blank(), items: items.map(i => ({ ...i, updatedAt: 1 })) };
  assert.deepEqual(T.mine(env), { name: 'My team', areas: ['Project\\Team'], connection: 'work', areaConnections: {} });
  const schemas = SchemaSet.fromDir(new URL('../../docs/schemas/', import.meta.url).pathname);
  for (const i of env.items) assert.deepEqual(schemas.validate('team', i), []);
  assert.equal(T.readable(null), true);
  assert.equal(T.readable({ ...env, version: 2 }), false);
});

test('teams: a connection per area path, grouped into one read per connection (docs/teams.md rule 3)', () => {
  let items = T.withMine([], { areas: 'Web\\Platform\nField\\Mobile\nWeb\\Data', connection: '', areaConnections: { 'Field\\Mobile': ' apps ', 'Gone\\Area': 'x', 'Web\\Data': '' } });
  const team = T.mine({ ...T.blank(), items });
  assert.deepEqual(team.areaConnections, { 'Field\\Mobile': 'apps' });
  assert.deepEqual(T.groups(team), [{ connection: '', areas: ['Web\\Platform', 'Web\\Data'] }, { connection: 'apps', areas: ['Field\\Mobile'] }]);
  assert.equal(T.connectionForPath(team, 'field\\mobile\\iOS'), 'apps');
  assert.equal(T.connectionForPath(team, 'Web\\Platform'), '');
  assert.equal(T.connectionForPath({ ...team, connection: 'main' }, 'Elsewhere'), 'main');
  // Saved without areaConnections: kept for the paths still listed.
  items = T.withMine(items, { areas: ['Field\\Mobile'], connection: 'main' });
  assert.deepEqual(T.mine({ ...T.blank(), items }).areaConnections, { 'Field\\Mobile': 'apps' });
  const schemas = SchemaSet.fromDir(new URL('../../docs/schemas/', import.meta.url).pathname);
  for (const i of items) assert.deepEqual(schemas.validate('team', { ...i, updatedAt: 1 }), []);
});
