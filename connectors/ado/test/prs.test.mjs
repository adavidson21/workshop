// workitem.prs (linked pull requests and their status) against the fake ADO server. Synthetic data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalize } from '../lib/config.mjs';
import { childIds, prLinks, prsStatus, workItemPrs } from '../lib/prs.mjs';
import { startFakeAdo } from './fake-ado.mjs';

const PAT = 'synthetic-pat-prs';
const PROJ = 'p-1111';
const link = (id, repo = 'r-api') => ({ rel: 'ArtifactLink', url: `vstfs:///Git/PullRequestId/${PROJ}%2F${repo}%2F${id}`, attributes: { name: 'Pull Request' } });
const child = (id) => ({ rel: 'System.LinkTypes.Hierarchy-Forward', url: `{{ADO}}/Main/_apis/wit/workItems/${id}`, attributes: { name: 'Child' } });
const wi = (id, type, state, relations = []) => ({ id, rev: 3, fields: { 'System.Id': id, 'System.Title': `Synthetic ${type} ${id}`, 'System.WorkItemType': type, 'System.State': state, 'System.TeamProject': 'Web App' }, relations });
const pr = (id, status, extra = {}) => ({ pullRequestId: id, status, title: `Synthetic change ${id}`, targetRefName: 'refs/heads/main', repository: { id: 'r-api', name: 'web-api', project: { id: PROJ, name: 'Web App' } }, ...extra });

function scenario() {
  return {
    pat: PAT,
    collections: {
      Main: {
        connectionData: { authenticatedUser: { id: 'u-me' } },
        workItems: {
          800: wi(800, 'Feature', 'Active', [child(801), child(802), link(900)]),
          801: wi(801, 'User Story', 'Resolved', [link(901), link(900)]),
          802: wi(802, 'User Story', 'Active', [link(902), link(999)]),
          810: wi(810, 'Bug', 'Active'),
          820: wi(820, 'User Story', 'Active', [link(903)])
        },
        pullRequests: {
          [PROJ]: [pr(900, 'completed', { closedDate: '2026-11-01T10:00:00Z' }), pr(901, 'completed'), pr(902, 'active'), pr(903, 'abandoned')]
        }
      }
    }
  };
}

async function withAdo(fn) {
  const srv = await startFakeAdo(scenario());
  const { config } = normalize({ connections: [{ name: 'main', serverUrl: srv.url, collection: 'Main', project: 'Web App', patEnv: 'TEST_ADO_PAT' }], defaultConnection: 'main' });
  const d = { cfg: config, env: name => (name === 'TEST_ADO_PAT' ? PAT : undefined) };
  try { return await fn({ d, srv }); } finally { await srv.close(); }
}

test('prLinks and childIds read the relations', () => {
  assert.deepEqual(prLinks([link(5), { rel: 'ArtifactLink', url: 'vstfs:///Git/Commit/abc' }, { url: null }]), [{ project: PROJ, repositoryId: 'r-api', id: 5 }]);
  assert.deepEqual(childIds([child(7), { rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'x/workItems/1' }]), [7]);
});

test('prsStatus: none, open, merged, abandoned; missing PRs do not count', () => {
  assert.equal(prsStatus([]), 'none');
  assert.equal(prsStatus([{ status: 'missing' }]), 'none');
  assert.equal(prsStatus([{ status: 'completed' }, { status: 'active' }]), 'open');
  assert.equal(prsStatus([{ status: 'completed' }, { status: 'abandoned' }, { status: 'missing' }]), 'merged');
  assert.equal(prsStatus([{ status: 'abandoned' }]), 'abandoned');
});

test('a Feature gathers its own and its children\'s PRs once each', () => withAdo(async ({ d }) => {
  const out = await workItemPrs(d, { id: 800 });
  assert.equal(out.type, 'Feature');
  assert.equal(out.connection, 'main');
  assert.deepEqual(out.children.map(c => [c.id, c.state]), [[801, 'Resolved'], [802, 'Active']]);
  assert.deepEqual(out.prs.map(p => [p.id, p.workItemId, p.status]), [[900, 800, 'completed'], [901, 801, 'completed'], [902, 802, 'active'], [999, 802, 'missing']]);
  assert.equal(out.status, 'open');
  assert.equal(out.prs[0].targetBranch, 'main');
  assert.equal(out.prs[0].closed, '2026-11-01T10:00:00Z');
  assert.match(out.prs[0].url, /\/Main\/Web%20App\/_git\/web-api\/pullrequest\/900$/);
  assert.equal(out.truncated, false);
}));

test('children: false reads only the item; no links is none; all done is merged', () => withAdo(async ({ d, srv }) => {
  const only = await workItemPrs(d, { id: 800, children: false });
  assert.deepEqual(only.prs.map(p => p.id), [900]);
  assert.equal(only.status, 'merged');
  assert.deepEqual(only.children, []);
  assert.equal((await workItemPrs(d, { id: 810 })).status, 'none');
  assert.equal((await workItemPrs(d, { id: 820 })).status, 'abandoned');
}));

test('a missing work item says so plainly', () => withAdo(async ({ d }) => {
  await assert.rejects(workItemPrs(d, { id: 4242 }), /Work item 4242 was not found on connection "main"/);
}));
