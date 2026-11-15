// The GitHub connector's issues, PRs, settings and token status, against the fake GitHub server.
import assert from 'node:assert/strict';
import test from 'node:test';
import { startFakeGitHub, scenario, TOKEN } from './fake-github.mjs';
import { addresses, normalize } from '../lib/config.mjs';
import { areaOf, areasMine, getIssue, parseId, priorityOf, splitBody, sync, typeOf } from '../lib/issues.mjs';
import { classify, syncPrs, prKey } from '../lib/prs.mjs';
import { clientFor } from '../lib/client.mjs';
import { configFromUrl } from '../lib/url.mjs';
import { authTracker, daysLeft, tokenStatus } from '../lib/token.mjs';

const NOW = new Date('2026-11-14T12:00:00Z');

function depsFor(srv, raw = {}, env = { GH: TOKEN }) {
  const { config } = normalize({ connections: [{ name: 'github', apiUrl: srv.url, tokenEnv: 'GH' }], ...raw });
  const read = n => env[n];
  const tracker = authTracker();
  read.onAuth = tracker.hooks(read);
  return { d: { cfg: config, env: read, now: NOW }, tracker, read };
}

async function withFake(fn, data = scenario()) {
  const srv = await startFakeGitHub(data);
  try { await fn(srv); } finally { await srv.close(); }
}

test('ids, types, priorities and areas', () => {
  assert.deepEqual(parseId('acme/web#12'), { repo: 'acme/web', number: 12 });
  assert.deepEqual(parseId('#12', 'acme/web'), { repo: 'acme/web', number: 12 });
  assert.deepEqual(parseId(12, 'acme/web'), { repo: 'acme/web', number: 12 });
  assert.equal(parseId('12'), null);
  assert.equal(parseId('acme/web#0x1'), null);
  assert.equal(typeOf(['P1', 'Bug']), 'Bug');
  assert.equal(typeOf(['User Story']), 'Story');
  assert.equal(typeOf(['docs']), 'Issue');
  assert.equal(priorityOf(['bug', 'P3']), 3);
  assert.equal(priorityOf(['priority: 1']), 1);
  assert.equal(priorityOf(['p5']), null);
  assert.equal(areaOf('acme/web', ['area: auth']), 'acme/web/auth');
  assert.equal(areaOf('acme/web', ['bug']), 'acme/web');
  assert.equal(areaOf('acme/web', ['team-x'], 'team-'), 'acme/web/x');
});

test('body sections stand in for ADO fields', () => {
  const s = splitBody('Intro\n\n## Repro steps\n1. a\n\n### Acceptance Criteria\n- b\n\n## Notes\nmore');
  assert.equal(s.reproSteps, '1. a');
  assert.equal(s.acceptanceCriteria, '- b');
  assert.equal(s.description, 'Intro\n\n## Notes\nmore');
});

test('addresses for github.com, Enterprise Server and a test server', () => {
  assert.deepEqual(addresses('https://api.github.com/'), { api: 'https://api.github.com', web: 'https://github.com', graphql: 'https://api.github.com/graphql' });
  assert.deepEqual(addresses('https://git.example.com/api/v3'), { api: 'https://git.example.com/api/v3', web: 'https://git.example.com', graphql: 'https://git.example.com/api/graphql' });
  assert.equal(addresses('ftp://x'), null);
});

test('settings: defaults, bad repos and names are problems', () => {
  const { config, problems } = normalize({ connections: [{ name: 'gh' }, { name: 'bad name' }], repos: ['acme/web', 'nope'] });
  assert.equal(config.connections[0].apiUrl, 'https://api.github.com');
  assert.equal(config.connections[0].tokenEnv, 'GITHUB_PAT');
  assert.deepEqual(config.repos, ['acme/web']);
  assert.deepEqual(config.types, ['Issue', 'Bug', 'Story']);
  assert.equal(problems.length, 2);
  assert.match(normalize({}).problems[0], /Add a GitHub connection/);
});

test('sync: my open issues of synced types, no PRs, no epics', () => withFake(async srv => {
  const { d } = depsFor(srv);
  const out = await sync(d, [], [], { prs: false });
  assert.deepEqual(out.items.map(i => i.id).sort(), ['acme/web#1', 'acme/web#2', 'me/tools#9']);
  const one = out.items.find(i => i.id === 'acme/web#1');
  assert.equal(one.type, 'Bug');
  assert.equal(one.priority, 2);
  assert.equal(one.due, '2026-12-15');
  assert.equal(one.state, 'Open');
  assert.equal(one.project, 'acme/web');
  assert.equal(out.prs, undefined);
  assert.ok(srv.requests.every(r => r.auth === `Bearer ${TOKEN}`));
}));

test('sync: repos limits which issues count', () => withFake(async srv => {
  const { d } = depsFor(srv, { repos: ['me/tools'] });
  const out = await sync(d, [], [], { prs: false });
  assert.deepEqual(out.items.map(i => i.id), ['me/tools#9']);
}));

test('sync: why known issues dropped off', () => withFake(async srv => {
  const { d } = depsFor(srv);
  const out = await sync(d, ['acme/web#5', 'acme/web#6', 'acme/web#7', 'acme/web#3', 'acme/web#4', 'acme/web#99', 'acme/web#1'], [], { prs: false });
  const why = Object.fromEntries(out.gone.map(g => [g.id, g.reason]));
  assert.deepEqual(why, { 'acme/web#5': 'closed', 'acme/web#6': 'removed', 'acme/web#7': 'reassigned', 'acme/web#3': 'filtered', 'acme/web#4': 'missing', 'acme/web#99': 'missing' });
  assert.equal(out.gone.find(g => g.id === 'acme/web#7').assignedTo, 'sam');
}));

test('sync.prs: tiers, waiting, not needed and gone', () => withFake(async srv => {
  const { d } = depsFor(srv);
  const gh = clientFor(d.cfg.connections[0], d.env);
  const k = n => prKey(srv.url, 'acme/web', n);
  const out = await syncPrs(d, [k(20), k(21), k(30), k(13)], gh);
  const items = Object.fromEntries(out.items.map(i => [i.id, i]));
  assert.deepEqual(Object.keys(items).map(Number).sort((a, b) => a - b), [10, 11, 20]);
  assert.equal(items[10].tier, 'blocking');
  assert.equal(items[11].tier, 'asked');
  assert.equal(items[20].waiting, true);
  assert.equal(items[10].commit, 'abc1234');
  assert.equal(items[10].key, k(10));
  const gone = Object.fromEntries(out.gone.map(g => [g.key, g.reason]));
  assert.equal(gone[k(21)], 'reviewed');
  assert.equal(gone[k(30)], 'merged');
  assert.equal(gone[k(13)], 'draft');
  assert.equal(out.notNeeded, 2); // team only (#12), approved by two others (#14)
}));

test('sync.prs: team PRs count when teamOnly is off; a teams error is a note', () => withFake(async srv => {
  const { d } = depsFor(srv, { prNotNeeded: { teamOnly: false, approvals: 0 } });
  const gh = clientFor(d.cfg.connections[0], d.env);
  const out = await syncPrs(d, [], gh);
  const team = out.items.find(i => i.id === 12);
  assert.equal(team.tier, 'pool');
  assert.deepEqual(team.via, ['Platform']);
  assert.ok(out.items.find(i => i.id === 14));
  srv.data.teamsForbidden = true;
  const again = await syncPrs(d, [], clientFor(d.cfg.connections[0], d.env));
  assert.match(again.notes[0], /^Team PRs skipped/);
  assert.equal(again.items.find(i => i.id === 12), undefined);
}));

test('sync includes PRs, and a PR failure is prError', () => withFake(async srv => {
  const { d } = depsFor(srv);
  const out = await sync(d, [], []);
  assert.ok(out.prs.items.length >= 2);
  srv.data.graphqlDown = true;
  const res = await sync(d, [], []);
  assert.equal(res.prs, undefined);
  assert.match(res.prError, /HTTP 502/);
  assert.equal(res.items.length, 3);
}));

test('classify: blocking only when you are the only one asked and a review is required', () => {
  const ctx = { me: 'me', teams: new Map(), web: 'https://github.com', nn: { teamOnly: true, canMerge: true, approvals: 2 } };
  const base = { number: 1, repository: { nameWithOwner: 'a/b', name: 'b' }, author: { login: 'x' }, state: 'OPEN',
    reviewRequests: { nodes: [{ requestedReviewer: { __typename: 'User', login: 'Me' } }] }, latestReviews: { nodes: [] } };
  assert.deepEqual(classify({ ...base, reviewDecision: 'REVIEW_REQUIRED' }, ctx).map(x => x.tier ?? x), ['review', 'blocking']);
  assert.equal(classify({ ...base, reviewDecision: null }, ctx)[1].tier, 'asked');
  assert.equal(classify({ ...base, reviewDecision: 'APPROVED' }, ctx)[0], 'notneeded');
  assert.equal(classify({ ...base, reviewRequests: { nodes: [] } }, ctx)[0], 'unassigned');
  assert.equal(classify({ ...base, reviewRequests: { nodes: [] }, latestReviews: { nodes: [{ state: 'APPROVED', author: { login: 'kim' } }] } }, ctx)[0], 'covered');
});

test('workitem.get: details, parent, comments; bare numbers need a repo', () => withFake(async srv => {
  const { d } = depsFor(srv);
  const it = await getIssue(d, { id: 'acme/web#1', details: true, comments: true });
  assert.equal(it.title, 'Fix login timeout');
  assert.equal(it.area, 'acme/web/auth');
  assert.equal(it.iteration, 'v2.1');
  assert.equal(it.reproSteps, '1. Open login\n2. Wait');
  assert.equal(it.acceptanceCriteria, '- No timeout');
  assert.equal(it.description, 'The login page times out.');
  assert.equal(it.comments[0].text, 'First');
  assert.equal(it.rev, '2026-11-10T12:00:00Z');
  const child = await getIssue(d, { id: 2, repo: 'acme/web', details: true });
  assert.equal(child.parent.id, 'acme/web#3');
  assert.equal(child.parent.type, 'Epic');
  await assert.rejects(getIssue(d, { id: 2 }), /owner\/repo#number/);
  await assert.rejects(getIssue(d, { id: 'acme/web#4' }), /pull request/);
  await assert.rejects(getIssue(d, { id: 'acme/web#404' }), e => e.code === 'not_found');
  const single = depsFor(srv, { repos: ['acme/web'] }).d;
  assert.equal((await getIssue(single, { id: '#2' })).id, 'acme/web#2');
}));

test('areas.mine: repo, or repo/area label', () => withFake(async srv => {
  const { d } = depsFor(srv);
  const out = await areasMine(d);
  assert.deepEqual(out.areas, [{ path: 'acme/web', count: 1 }, { path: 'acme/web/auth', count: 1 }, { path: 'me/tools', count: 1 }]);
}));

test('token: missing, rejected, expiry from GitHub, rate limit', () => withFake(async srv => {
  const cfg = normalize({ connections: [{ name: 'github', apiUrl: srv.url, tokenEnv: 'GH' }] }).config;
  assert.equal(tokenStatus(cfg, () => undefined, null).state, 'error');
  const { d, tracker, read } = depsFor(srv, {}, { GH: 'wrong' });
  await assert.rejects(sync(d, [], [], { prs: false }), e => e.code === 'unavailable' && /rejected the token in GH/.test(e.message) && !e.message.includes('wrong'));
  assert.match(tokenStatus(cfg, read, tracker).message, /GitHub rejected the token in GH/);
  const ok = depsFor(srv);
  await sync(ok.d, [], [], { prs: false });
  assert.equal(ok.tracker.expiry('GH'), '2099-01-31');
  const soon = new Date('2099-01-25T12:00:00Z');
  assert.match(tokenStatus(cfg, ok.read, ok.tracker, { now: soon }).message, /expires in 6 days/);
  assert.equal(daysLeft('2026-02-30'), null);
  srv.data.rateLimited = true;
  await assert.rejects(sync(ok.d, [], [], { prs: false }), /rate limit/);
}));

test('config.fromUrl: github.com and Enterprise links', () => {
  const a = configFromUrl('https://github.com/acme/web/issues/12');
  assert.equal(a.config.connections[0].apiUrl, 'https://api.github.com');
  assert.equal(a.config.defaultConnection, 'github');
  const b = configFromUrl('https://git.example.com/acme/web/pull/3', { connections: [{ name: 'github', apiUrl: 'https://api.github.com' }], repos: ['me/tools'] });
  assert.equal(b.config.connections[1].apiUrl, 'https://git.example.com/api/v3');
  assert.deepEqual(b.config.repos, ['me/tools', 'acme/web']);
  assert.throws(() => configFromUrl('not a link'), /not a link/);
});
