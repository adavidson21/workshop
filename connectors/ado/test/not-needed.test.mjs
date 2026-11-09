// PRs that don't need you (cfg.prNotNeeded, lib/sync.mjs): left out of sync.prs items, known ones reported
// gone as "notneeded". Synthetic data only, against the fake ADO server.
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalize } from '../lib/config.mjs';
import { syncPrs } from '../lib/sync.mjs';
import { startFakeAdo } from './fake-ado.mjs';

const PAT = 'synthetic-pat-not-needed';
const ME = 'u-me';
const rev = (rid, vote, extra = {}) => ({ id: rid, displayName: rid, vote, ...extra });
const pr = (n, reviewers) => ({ pullRequestId: n, status: 'active', title: `Synthetic change ${n}`, isDraft: false,
  repository: { id: 'r-api', name: 'web-api' }, createdBy: { id: 'u-b', displayName: 'Engineer B' }, creationDate: '2026-11-02T14:00:00Z', reviewers });

const PRS = [
  pr(1, [rev(ME, 0, { isRequired: true }), rev('u-a', 10, { isRequired: true }), rev('u-b', 10), rev('u-c', 10)]), // required: always needs you
  pr(2, [rev(ME, 0), rev('u-a', 0, { isRequired: true })]),                                                         // optional, nothing approved: pending
  pr(3, [rev(ME, 0), rev('u-a', 10, { isRequired: true }), rev('u-b', 5, { isRequired: true })]),                   // every required approved
  pr(4, [rev(ME, 0), rev('u-a', 10), rev('u-b', 5)]),                                                               // two others approved
  pr(5, [rev(ME, 0), rev('u-a', 10), rev('t-team', 10, { isContainer: true })]),                                    // one person; a group vote does not count
  pr(6, [rev('t-platform', 0)]),                                                                                    // team only
  pr(7, [rev(ME, -5), rev('u-a', 10), rev('u-b', 10)])                                                              // you asked for changes: still yours
];

async function run(prNotNeeded, knownPrs = []) {
  const srv = await startFakeAdo({
    pat: PAT,
    collections: { Main: {
      connectionData: { authenticatedUser: { id: ME } },
      teams: { 'Web App': [{ id: 't-platform', name: 'Platform' }] },
      pullRequests: { 'Web App': PRS }
    } }
  });
  try {
    const raw = { connections: [{ name: 'main', serverUrl: srv.url, collection: 'Main', project: 'Web App', patEnv: 'TEST_ADO_PAT' }],
      defaultConnection: 'main', prSources: [{ connection: 'main', project: 'Web App' }] };
    if (prNotNeeded !== undefined) raw.prNotNeeded = prNotNeeded;
    const { config } = normalize(raw);
    return await syncPrs({ cfg: config, env: n => (n === 'TEST_ADO_PAT' ? PAT : undefined) }, knownPrs.map(n => `${srv.url}/Main|Web App|${n}`));
  } finally { await srv.close(); }
}
const ids = out => out.items.map(p => p.id).sort((a, b) => a - b);

test('defaults: team-only, can merge without you, and two other approvals do not need you', async () => {
  const out = await run(undefined);
  assert.deepEqual(ids(out), [1, 2, 5, 7]);
  assert.equal(out.notNeeded, 3);
  assert.equal(out.items.find(p => p.id === 1).tier, 'blocking');
});

test('each rule can be turned off', async () => {
  assert.deepEqual(ids(await run({ teamOnly: false, canMerge: true, approvals: 2 })), [1, 2, 5, 6, 7]);
  assert.deepEqual(ids(await run({ teamOnly: true, canMerge: false, approvals: 0 })), [1, 2, 3, 4, 5, 7]);
  assert.deepEqual(ids(await run({ teamOnly: true, canMerge: false, approvals: 1 })), [1, 2, 7]);
  const off = await run({ teamOnly: false, canMerge: false, approvals: 0 });
  assert.deepEqual(ids(off), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(off.notNeeded, 0);
});

test('a known PR that stops needing you is gone with reason notneeded', async () => {
  const out = await run(undefined, [3, 4, 6]);
  const gone = Object.fromEntries(out.gone.map(g => [g.id, [g.reason, g.notNeeded]]));
  assert.deepEqual(gone, { 3: ['notneeded', 'merge'], 4: ['notneeded', 'approvals'], 6: ['notneeded', 'team'] });
});
