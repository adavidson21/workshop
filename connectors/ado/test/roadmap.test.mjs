// The roadmap action (Epics and Features with story progress) against the fake ADO server.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createMockAgent } from '../../../tests/mock-agent.mjs';
import { post } from '../../../tests/contract/helpers.mjs';
import ado from '../index.mjs';
import { normalize } from '../lib/config.mjs';
import { roadmapList } from '../lib/roadmap.mjs';
import { startFakeAdo } from './fake-ado.mjs';
import { PAT, roadmapScenario } from './fixtures/roadmap.mjs';
import { REPO } from './harness.mjs';

const configFor = url => ({
  connections: [{ name: 'main', serverUrl: url, collection: 'Main', project: 'Web App', patEnv: 'TEST_ADO_PAT' }],
  defaultConnection: 'main'
});

async function withAdo(fn) {
  const srv = await startFakeAdo(roadmapScenario());
  const { config } = normalize(configFor(srv.url));
  const d = { cfg: config, env: name => (name === 'TEST_ADO_PAT' ? PAT : undefined) };
  try {
    return await fn({ d, srv });
  } finally {
    await srv.close();
  }
}

const TEAM_A = 'Web App\\Team A';

test('roadmap returns open Epics and Features in the roadmap shape, with story counts per Feature', () => withAdo(async ({ d, srv }) => {
  const out = await roadmapList(d, { areas: [TEAM_A] });
  assert.equal(out.connection, 'main');
  assert.equal(out.truncated, false);
  assert.equal(out.childrenTruncated, false);
  assert.deepEqual(out.items.map(i => i.id), [701, 711, 712, 702]);
  assert.deepEqual(out.items[0], {
    id: 701, rev: 5, type: 'Epic', title: 'Synthetic version 1', state: 'Active', area: TEAM_A, iteration: 'Web App\\Sprint 12',
    parentId: null, targetDate: '2026-12-15', startDate: '2026-10-01', changed: '2026-10-14T15:30:00Z',
    url: `${srv.url}/Main/Web%20App/_workitems/edit/701`
  });
  const f711 = out.items.find(i => i.id === 711);
  assert.equal(f711.parentId, 701);
  assert.equal(f711.startDate, null);
  // 801 Closed and 803 Resolved count as done; 802 Active does not. 803 is in another area but still counts.
  assert.deepEqual([f711.storiesTotal, f711.storiesDone], [3, 2]);
  const f712 = out.items.find(i => i.id === 712);
  assert.deepEqual([f712.storiesTotal, f712.storiesDone], [1, 0]);
  assert.equal('storiesTotal' in out.items[0], false, 'Epics carry no counts of their own');

  const wiql = srv.requests.filter(r => r.includes('wit/wiql'));
  assert.match(wiql[0], /\[System\.WorkItemType\] IN \('Epic', 'Feature'\)/);
  assert.match(wiql[0], /\[System\.State\] NOT IN \('Resolved', 'Closed', 'Done', 'Removed'\)/);
  assert.match(wiql[1], /\[System\.Parent\] IN \(711, 712\)/);
  assert.match(wiql[1], /\[System\.State\] NOT IN \('Removed'\)/);
  const light = srv.requests.find(r => r.includes('workitemsbatch') && r.includes('System.Parent'));
  assert.ok(light, 'children are read with only the fields counting needs');
  assert.equal(srv.requests.some(r => /^(PATCH|DELETE)/.test(r)), false, 'read-only');
}));

test('roadmap with includeClosed adds closed items and counts their stories', () => withAdo(async ({ d }) => {
  const out = await roadmapList(d, { areas: [TEAM_A], includeClosed: true });
  assert.deepEqual(out.items.map(i => i.id), [701, 711, 712, 702, 713]);
  const f713 = out.items.find(i => i.id === 713);
  assert.deepEqual([f713.storiesTotal, f713.storiesDone], [1, 1]);
}));

test('roadmap refuses missing or unsafe area paths, naming the Roadmap settings', () => withAdo(async ({ d }) => {
  await assert.rejects(roadmapList(d, { areas: [] }), /Roadmap settings/);
  await assert.rejects(roadmapList(d, { areas: ["Web App' OR 1=1"] }), e => e.code === 'bad_request');
}));

test('roadmap is a read action, and works through the agent', async () => {
  assert.equal(ado.actions.roadmap.write, false);
  const srv = await startFakeAdo(roadmapScenario());
  const cfg = { configVersion: 1, connectors: { ado: { enabled: true, config: configFor(srv.url) } } };
  const agent = await createMockAgent({ connectorsDir: path.join(REPO, 'connectors'), appsDir: path.join(REPO, 'tests', 'fixtures', 'apps'), env: { TEST_ADO_PAT: PAT }, config: cfg, log: () => {} });
  try {
    const r = await post(agent, '/api/connectors/ado/roadmap', { args: { areas: [TEAM_A] } });
    assert.equal(r.status, 200);
    assert.equal(r.json.result.items.length, 4);
    const bad = await post(agent, '/api/connectors/ado/roadmap', { args: {} });
    assert.equal(bad.status, 400);
    assert.equal(srv.requests.some(x => x.includes(PAT)), false);
  } finally {
    await agent.stop();
    await srv.close();
  }
});
