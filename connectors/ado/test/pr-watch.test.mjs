// pr.status (1.16.0): a published PR found by its branch, with CI, reviews, comments and failed logs, against the
// fake ADO server. Synthetic data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalize } from '../lib/config.mjs';
import { checksOf, ciState, connectionFor, logTail, prStatus, reviewOf, threadsOf } from '../lib/pr-watch.mjs';
import { startFakeAdo } from './fake-ado.mjs';

const PAT = 'synthetic-pat-watch';
const PROJ = 'p-2222';
const REPO = 'web-api';
const repoPath = `git/repositories/${REPO}`;
const pr = (extra = {}) => ({ pullRequestId: 77, status: 'active', title: 'Send rate limit headers', creationDate: '2026-11-19T10:00:00Z', mergeStatus: 'succeeded',
  createdBy: { id: 'u-me', displayName: 'Engineer A' }, lastMergeSourceCommit: { commitId: 'abc123' }, repository: { id: 'r-1', name: REPO, project: { id: PROJ, name: 'Web App' } },
  reviewers: [{ id: 'u-b', displayName: 'Engineer B', vote: 0, isRequired: true }], ...extra });

function scenario(over = {}) {
  return {
    pat: PAT,
    collections: {
      Main: {
        connectionData: { authenticatedUser: { id: 'u-me' } },
        routes: [
          { path: `${repoPath}/pullrequests`, query: { 'searchCriteria.sourceRefName': 'refs/heads/dev/bug/77-headers' }, out: { value: over.prs || [pr()] } },
          { path: `${repoPath}/pullrequests`, out: { value: [] } },
          { path: 'policy/evaluations', out: { value: over.evaluations || [{ status: 'rejected', configuration: { type: { displayName: 'Build' }, settings: { buildDefinitionId: 12, displayName: 'CI' } }, context: { buildId: 501 } }] } },
          { path: `${repoPath}/pullrequests/77/statuses`, out: { value: [] } },
          { path: 'build/builds/501/timeline', out: over.timeline || { records: [{ type: 'Task', name: 'Run unit tests', result: 'failed', log: { id: 9 } }, { type: 'Task', name: 'Build', result: 'succeeded', log: { id: 8 } }] } },
          { path: 'build/builds/501/logs/9', out: { $text: '2026-11-19T10:01:00.1234567Z Starting tests\n2026-11-19T10:02:00.1234567Z Failed HeaderTests.Writes_limit\n' } },
          { path: 'build/builds', query: { definitions: '12', branchName: 'refs/heads/main' }, out: over.builds || { value: [{ id: 400, result: over.baseResult || 'succeeded' }] } },
          { path: `${repoPath}/pullrequests/77/threads`, out: { value: [
            { id: 1, status: 'active', threadContext: { filePath: '/src/HeaderWriter.cs', rightFileStart: { line: 18 } }, comments: [{ author: { id: 'u-b', displayName: 'Engineer B' }, content: 'Read the limit from options.', commentType: 'text' }] },
            { id: 2, status: 'active', comments: [{ author: { id: 'u-me' }, content: 'My own note', commentType: 'text' }] },
            { id: 3, status: 'active', comments: [{ author: { id: 'u-sys' }, content: 'Policy updated', commentType: 'system' }] },
            { id: 4, status: 'fixed', threadContext: { filePath: '/src/a.cs', rightFileStart: { line: 2 } }, comments: [{ author: { id: 'u-c', displayName: 'Engineer C' }, content: 'Typo', commentType: 'text' }, { author: { id: 'u-me' }, content: 'Fixed', commentType: 'text' }] }
          ] } }
        ]
      }
    }
  };
}

async function withAdo(over, fn) {
  const srv = await startFakeAdo(scenario(over));
  const { config } = normalize({ connections: [{ name: 'main', serverUrl: srv.url, collection: 'Main', project: 'Web App', patEnv: 'TEST_ADO_PAT' }], defaultConnection: 'main' });
  const d = { cfg: config, env: name => (name === 'TEST_ADO_PAT' ? PAT : undefined) };
  try { return await fn({ d, srv, remote: `${srv.url}/Main/Web%20App/_git/${REPO}` }); } finally { await srv.close(); }
}

test('helpers: reviews, checks, CI in one word, log tails, threads', () => {
  assert.equal(reviewOf([{ vote: 10, isRequired: true }, { vote: 0 }]), 'approved');
  assert.equal(reviewOf([{ vote: 10, isRequired: true }, { vote: -5 }]), 'changes');
  assert.equal(reviewOf([{ vote: 0, isRequired: true }]), 'waiting');
  const checks = checksOf([{ status: 'running', configuration: { type: { displayName: 'Build' }, settings: { displayName: 'CI' } } }, { status: 'approved', configuration: { type: { displayName: 'Minimum number of reviewers' } } }],
    [{ state: 'pending', context: { genre: 'x', name: 'scan' }, creationDate: '1' }, { state: 'failed', context: { genre: 'x', name: 'scan' }, creationDate: '2', description: 'Security scan', targetUrl: 'https://ci/1' }]);
  assert.deepEqual(checks.map(c => [c.name, c.state]), [['CI', 'running'], ['Security scan', 'failed']]);
  assert.equal(ciState(checks), 'failed');
  assert.equal(ciState([]), 'none');
  assert.equal(logTail('2026-11-19T10:00:00.1Z a\n2026-11-19T10:00:01.1Z b\n\n', 1), 'b');
  assert.equal(threadsOf([{ id: 5, comments: [{ content: 'x', commentType: 'text', isDeleted: true }] }]).length, 0);
  assert.throws(() => connectionFor({ connections: [] }, 'https://github.com/o/r'), /not an Azure DevOps repo/);
});

test('a PR with failed CI: found by branch, the failed step\'s log, the base passes, people\'s threads only', () => withAdo({}, async ({ d, remote }) => {
  const s = await prStatus(d, { remote, branch: 'dev/bug/77-headers', target: 'main', logs: true });
  assert.equal(s.found, true);
  assert.equal(s.id, 77);
  assert.match(s.url, /\/Main\/Web%20App\/_git\/web-api\/pullrequest\/77$/);
  assert.equal(s.review, 'waiting');
  assert.equal(s.ci.state, 'failed');
  assert.equal(s.ci.baseFailing, false);
  assert.deepEqual(s.ci.checks.map(c => [c.name, c.state]), [['CI', 'failed']]);
  assert.match(s.ci.checks[0].log, /^## Run unit tests\nStarting tests\nFailed HeaderTests\.Writes_limit$/);
  assert.match(s.ci.checks[0].url, /_build\/results\?buildId=501$/);
  assert.deepEqual(s.threads.map(t => [t.id, t.path, t.line, t.author, t.resolved]), [['ado-1', 'src/HeaderWriter.cs', 18, 'Engineer B', false], ['ado-4', 'src/a.cs', 2, 'Engineer C', true]]);
}));

test('the same pipeline failing on the target branch is not this change; merged and conflicting PRs; no PR yet', async () => {
  await withAdo({ baseResult: 'failed' }, async ({ d, remote }) => {
    assert.equal((await prStatus(d, { remote, branch: 'dev/bug/77-headers', target: 'main', logs: true })).ci.baseFailing, true);
  });
  await withAdo({ prs: [pr({ status: 'completed' })] }, async ({ d, remote }) => {
    const s = await prStatus(d, { remote, branch: 'dev/bug/77-headers' });
    assert.deepEqual([s.merged, s.ci.state, s.threads.length], [true, 'none', 0]);
  });
  await withAdo({ prs: [pr({ mergeStatus: 'conflicts' })], evaluations: [] }, async ({ d, remote }) => {
    const s = await prStatus(d, { remote, branch: 'dev/bug/77-headers' });
    assert.deepEqual([s.conflict, s.ci.state], [true, 'none']);
  });
  await withAdo({}, async ({ d, remote }) => {
    assert.deepEqual(await prStatus(d, { remote, branch: 'dev/other' }), { found: false, host: 'ado', connection: 'main' });
    await assert.rejects(prStatus(d, { remote: 'https://elsewhere.example/Main/P/_git/r', branch: 'x' }), /No ADO connection for https:\/\/elsewhere\.example\/Main/);
  });
});

test('a PAT without Build (Read) still answers where the PR stands; the log says why it is missing', () => withAdo({ timeline: { $status: 403 }, builds: { $status: 403 } }, async ({ d, remote }) => {
  const s = await prStatus(d, { remote, branch: 'dev/bug/77-headers', target: 'main', logs: true });
  assert.deepEqual([s.found, s.ci.state, s.ci.baseFailing, s.threads.length], [true, 'failed', false, 2]);
  assert.match(s.ci.checks[0].log, /^Workshop could not read the log: .*Build \(Read\)/);
}));
