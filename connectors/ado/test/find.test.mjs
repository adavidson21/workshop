// workitem.find (an id on every connection) and areas.mine on a named connection, against the fake ADO server.
// Synthetic data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalize } from '../lib/config.mjs';
import { findWorkItem } from '../lib/workitem.mjs';
import { areasMine } from '../lib/sync.mjs';
import { startFakeAdo } from './fake-ado.mjs';

const PAT = 'synthetic-pat-find';
const wi = (id, title, project, area) => ({ id, rev: 4, fields: { 'System.Id': id, 'System.Title': title, 'System.WorkItemType': 'User Story', 'System.State': 'New', 'System.TeamProject': project, 'System.AreaPath': area } });

function scenario() {
  return {
    pat: PAT,
    collections: {
      Main: {
        connectionData: { authenticatedUser: { id: 'u-me' } },
        workItems: { 500: wi(500, 'Synthetic main story', 'Web App', 'Web App\\Platform'), 700: wi(700, 'Only in main', 'Web App', 'Web App\\Platform') },
        wiql: [{ match: ['[System.AssignedTo] = @Me'], ids: [700] }]
      },
      Apps: {
        connectionData: { authenticatedUser: { id: 'u-me' } },
        workItems: { 500: wi(500, 'Synthetic apps story', 'Field', 'Field\\Mobile'), 600: wi(600, 'Only in apps', 'Field', 'Field\\Mobile') },
        wiql: [{ match: ['[System.AssignedTo] = @Me'], ids: [500, 600] }]
      }
    }
  };
}

async function withAdo(fn, { extra = [] } = {}) {
  const srv = await startFakeAdo(scenario());
  const { config } = normalize({
    connections: [
      { name: 'main', serverUrl: srv.url, collection: 'Main', patEnv: 'TEST_ADO_PAT' },
      { name: 'apps', serverUrl: srv.url, collection: 'Apps', patEnv: 'TEST_ADO_PAT' },
      ...extra.map(e => ({ ...e, serverUrl: srv.url }))
    ],
    defaultConnection: 'main'
  });
  const d = { cfg: config, env: name => (name === 'TEST_ADO_PAT' ? PAT : undefined) };
  try { return await fn({ d, srv }); } finally { await srv.close(); }
}

test('workitem.find: an id in both collections comes back twice, with each connection', () => withAdo(async ({ d }) => {
  const out = await findWorkItem(d, { id: 500 });
  assert.deepEqual(out.failed, []);
  assert.deepEqual(out.matches.map(m => [m.connection, m.title, m.project, m.area, m.rev]), [
    ['main', 'Synthetic main story', 'Web App', 'Web App\\Platform', 4],
    ['apps', 'Synthetic apps story', 'Field', 'Field\\Mobile', 4]
  ]);
}));

test('workitem.find: an id in one collection comes back once; none is an empty list', () => withAdo(async ({ d }) => {
  assert.deepEqual((await findWorkItem(d, { id: 600 })).matches.map(m => m.connection), ['apps']);
  const none = await findWorkItem(d, { id: 999 });
  assert.deepEqual(none, { id: 999, matches: [], failed: [] });
}));

test('workitem.find: a connection it cannot read is a failure, not "not there"', () => withAdo(async ({ d }) => {
  const out = await findWorkItem(d, { id: 700 });
  assert.deepEqual(out.matches.map(m => m.connection), ['main']);
  assert.deepEqual(out.failed.map(f => f.connection), ['nopat']);
  assert.ok(out.failed[0].message);
}, { extra: [{ name: 'nopat', collection: 'Apps', patEnv: 'MISSING_PAT' }] }));

test('areas.mine reads the named connection, else the sync connection', () => withAdo(async ({ d }) => {
  const apps = await areasMine(d, { connection: 'apps' });
  assert.equal(apps.connection, 'apps');
  assert.deepEqual(apps.areas, [{ path: 'Field\\Mobile', count: 2 }]);
  const main = await areasMine(d);
  assert.equal(main.connection, 'main');
  assert.deepEqual(main.areas, [{ path: 'Web App\\Platform', count: 1 }]);
}));
