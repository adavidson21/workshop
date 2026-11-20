// pr.status (1.4.0): a published PR found by its head branch, with checks, reviews, comments and failed check output.
// Uses a stub client: synthetic data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalize } from '../lib/config.mjs';
import { connectionFor, parseRemote, prStatus, reviewOf } from '../lib/pr-watch.mjs';

function stub(routes) {
  const calls = [];
  return { calls, rest: async (method, path, { query } = {}) => {
    calls.push(path + (query ? '?' + new URLSearchParams(query) : ''));
    const k = Object.keys(routes).find(p => p === path);
    if (!k) throw new Error(`no route ${path}`);
    return typeof routes[k] === 'function' ? routes[k](query) : routes[k];
  } };
}
const R = { host: 'github.com', owner: 'acme', repo: 'web' };
const base = (over = {}) => ({
  '/repos/acme/web/pulls': [{ number: 9, state: 'open', created_at: '2026-11-19' }],
  '/repos/acme/web/pulls/9': { number: 9, state: 'open', merged: false, mergeable: true, mergeable_state: 'clean', html_url: 'https://github.com/acme/web/pull/9', title: 'Headers', user: { login: 'me' }, head: { sha: 'abc' }, ...over.pr },
  '/repos/acme/web/pulls/9/reviews': [{ user: { login: 'sam' }, state: 'APPROVED' }, { user: { login: 'kim' }, state: 'COMMENTED' }],
  '/repos/acme/web/commits/abc/check-runs': { check_runs: over.runs || [{ id: 1, name: 'test', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/acme/web/runs/1', output: { title: '2 tests failed', summary: 'HeaderTests' } }, { id: 2, name: 'lint', status: 'completed', conclusion: 'success' }] },
  '/repos/acme/web/commits/abc/status': { statuses: [] },
  '/repos/acme/web/check-runs/1/annotations': [{ path: 'src/h.ts', start_line: 4, annotation_level: 'failure', message: 'expected 3' }],
  '/repos/acme/web/commits/main/check-runs': { check_runs: [{ status: 'completed', conclusion: over.baseConclusion || 'success' }] },
  '/repos/acme/web/pulls/9/comments': [{ id: 31, path: 'src/h.ts', line: 4, body: 'Use the constant', user: { login: 'sam', type: 'User' } }, { id: 32, in_reply_to_id: 31, body: 'ok', user: { login: 'me', type: 'User' } }],
  '/repos/acme/web/issues/9/comments': [{ id: 41, body: 'Looks good', user: { login: 'kim', type: 'User' } }, { id: 42, body: 'Deployed preview', user: { login: 'bot', type: 'Bot' } }]
});

test('remotes and connections', () => {
  assert.deepEqual(parseRemote('git@github.com:acme/web.git'), { host: 'github.com', owner: 'acme', repo: 'web' });
  assert.deepEqual(parseRemote('https://x-access-token@github.com/acme/web'), { host: 'github.com', owner: 'acme', repo: 'web' });
  assert.equal(parseRemote('not a remote'), null);
  const { config } = normalize({ connections: [{ name: 'gh' }] });
  assert.equal(connectionFor(config, 'https://github.com/acme/web.git').conn.name, 'gh');
  assert.throws(() => connectionFor(config, 'https://git.example.com/acme/web'), /No GitHub connection for git\.example\.com/);
  assert.equal(reviewOf([{ user: { login: 'a' }, state: 'CHANGES_REQUESTED' }, { user: { login: 'a' }, state: 'APPROVED' }]), 'approved', 'the latest review per person counts');
});

test('failed CI with its output, approved, people\'s comments only; the base passing means it is this change', async () => {
  const gh = stub(base());
  const s = await prStatus(gh, { remote: 'x', branch: 'dev/bug/9-headers', target: 'main', logs: true }, R);
  assert.equal(gh.calls[0], '/repos/acme/web/pulls?head=acme%3Adev%2Fbug%2F9-headers&state=all&per_page=10');
  assert.deepEqual([s.found, s.id, s.status, s.review, s.ci.state, s.ci.baseFailing, s.conflict], [true, 9, 'active', 'approved', 'failed', false, false]);
  assert.equal(s.ci.checks[0].log, '## test\n2 tests failed\nHeaderTests\nsrc/h.ts:4 failure: expected 3');
  assert.deepEqual(s.threads.map(t => [t.id, t.path, t.line, t.author]), [['gh-31', 'src/h.ts', 4, 'sam'], ['ghc-41', null, null, 'kim']]);
  assert.equal((await prStatus(stub(base({ baseConclusion: 'failure' })), { remote: 'x', branch: 'b', target: 'main', logs: true }, R)).ci.baseFailing, true);
});

test('merged, conflicting, running and no PR', async () => {
  const merged = await prStatus(stub(base({ pr: { state: 'closed', merged: true } })), { remote: 'x', branch: 'b' }, R);
  assert.deepEqual([merged.merged, merged.status, merged.threads.length], [true, 'completed', 0]);
  const dirty = await prStatus(stub(base({ pr: { mergeable: false, mergeable_state: 'dirty' }, runs: [{ id: 3, name: 'test', status: 'in_progress' }] })), { remote: 'x', branch: 'b' }, R);
  assert.deepEqual([dirty.conflict, dirty.ci.state], [true, 'running']);
  assert.deepEqual(await prStatus(stub({ '/repos/acme/web/pulls': [] }), { remote: 'x', branch: 'b' }, R), { found: false, host: 'github' });
});
