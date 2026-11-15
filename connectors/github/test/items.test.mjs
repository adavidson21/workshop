// The GitHub connector's work items for Loom: backlog, one item, find, linked PRs, and the two writes, against the
// fake GitHub server. Loom names a GitHub item by its number with the repo as the connection.
import assert from 'node:assert/strict';
import test from 'node:test';
import { startFakeGitHub, TOKEN } from './fake-github.mjs';
import { normalize } from '../lib/config.mjs';
import { backlogList, createItem, findItem, getItem, itemPrs, joinBody, overall, repoIterations, typeLabel, updateItem } from '../lib/items.mjs';

async function withD(fn, raw = {}) {
  const srv = await startFakeGitHub();
  try {
    const { config } = normalize({ connections: [{ name: 'github', apiUrl: srv.url, tokenEnv: 'GH' }], ...raw });
    await fn({ cfg: config, env: n => (n === 'GH' ? TOKEN : undefined), now: new Date('2026-11-14T12:00:00Z') }, srv);
  } finally { await srv.close(); }
}
const C = { connection: 'acme/web' };

test('type labels for create, body sections, overall PR status', () => {
  assert.equal(typeLabel('User Story'), 'story');
  assert.equal(typeLabel('Product Backlog Item'), 'story');
  assert.equal(typeLabel('Feature'), 'feature');
  assert.equal(typeLabel('Bug'), 'bug');
  assert.equal(typeLabel('Issue'), '');
  assert.equal(joinBody('Old\n\n## Repro steps\n1. a\n\n## Acceptance criteria\n- x', { description: 'New' }), 'New\n\n## Repro steps\n\n1. a\n\n## Acceptance criteria\n\n- x');
  assert.equal(joinBody('', { description: 'D', acceptance: '- y', releaseNote: 'Faster.' }), 'D\n\n## Acceptance criteria\n\n- y\n\n## Release note\n\nFaster.');
  assert.equal(overall([]), 'none');
  assert.equal(overall([{ status: 'completed' }, { status: 'active' }]), 'open');
  assert.equal(overall([{ status: 'completed' }, { status: 'abandoned' }]), 'merged');
  assert.equal(overall([{ status: 'abandoned' }]), 'abandoned');
});

test('backlog: open issues by number with the repo as connection; areas, types, parents and milestones', () => withD(async d => {
  const r = await backlogList(d, { areas: ['acme/web'] });
  assert.equal(r.connection, 'acme/web');
  const by = Object.fromEntries(r.items.map(i => [i.id, i]));
  assert.ok(by[1] && by[2] && by[40] && by[41]);
  assert.ok(!by[4], 'pull requests are left out');
  assert.ok(!by[5], 'closed issues are left out');
  assert.equal(by[2].parentId, 40, 'a sub-issue points at its parent');
  assert.equal(by[40].parentId, -1, 'an issue in a milestone points at its Epic');
  assert.equal(by[1].type, 'Bug');
  assert.equal(by[2].type, 'User Story');
  assert.equal(by[1].area, 'acme/web/auth');
  assert.equal(by[1].iteration, 'v2.1');
  assert.equal(by[1].priority, 2);
  assert.ok(Number.isInteger(by[1].rev) && by[1].rev > 0);
  const auth = await backlogList(d, { areas: ['acme/web/auth'] });
  assert.deepEqual(auth.items.map(i => i.id).sort((a, b) => a - b), [1, 40]);
  const stories = await backlogList(d, { areas: ['acme/web'], types: ['User Story'] });
  assert.deepEqual(stories.items.map(i => i.id), [2]);
  await assert.rejects(backlogList(d, { areas: ['Project'] }), /owner\/repo/);
}));

test('workitem.get: details, extras (children, release note), comments; an Epic by its negative id', () => withD(async d => {
  const it = await getItem(d, { ...C, id: 40, details: true, extras: true, comments: true, fields: ['Custom.ReleaseNotes', 'Custom.Other'] });
  assert.equal(it.id, 40);
  assert.equal(it.connection, 'acme/web');
  assert.equal(it.type, 'Feature');
  assert.equal(it.area, 'acme/web/auth');
  assert.equal(it.custom['Custom.ReleaseNotes'], 'Sign-in is faster.');
  assert.equal(it.custom['Custom.Other'], '');
  assert.deepEqual(it.links.items.map(k => k.id), [43, 44]);
  assert.deepEqual(it.assignee, { name: 'kim', email: '' });
  assert.deepEqual(it.comments, []);
  const one = await getItem(d, { ...C, id: 1, comments: true });
  assert.equal(one.comments[0].by.name, 'sam');
  const epic = await getItem(d, { ...C, id: -1, details: true });
  assert.equal(epic.type, 'Epic');
  assert.equal(epic.title, 'v2.1');
  assert.equal(epic.targetDate, '2026-12-15');
  await assert.rejects(getItem(d, { ...C, id: 4 }), /pull request/);
}));

test('workitem.find: a number in every repo in Settings, or a plain note without repos', () => withD(async d => {
  const none = await findItem(d, { id: 1 });
  assert.equal(none.matches.length, 0);
  assert.match(none.failed[0].message, /List your repos/);
  const { config } = normalize({ connections: d.cfg.connections.map(c => ({ name: c.name, apiUrl: c.apiUrl, tokenEnv: c.tokenEnv })), repos: ['acme/web', 'me/tools'] });
  const r = await findItem({ ...d, cfg: config }, { id: 9 });
  assert.deepEqual(r.matches.map(m => m.connection), ['me/tools']);
}));

test('workitem.prs: PRs closing the item and its sub-issues, with an overall status', () => withD(async d => {
  const r = await itemPrs(d, { ...C, id: 40 });
  assert.deepEqual(r.prs.map(p => [p.id, p.workItemId, p.status]), [[60, 40, 'completed'], [61, 43, 'active']]);
  assert.equal(r.status, 'open');
  assert.deepEqual(r.children.map(c => c.id), [43, 44]);
  const only = await itemPrs(d, { ...C, id: 40, children: false });
  assert.equal(only.status, 'merged');
}));

test('workitem.update: one PATCH with labels, state, assignee and milestone; conflicts; comments and related', () => withD(async (d, srv) => {
  const before = await getItem(d, { ...C, id: 1 });
  const out = await updateItem(d, { ...C, id: 1, rev: before.rev, changes: { title: 'Fix login', priority: 1, tagsAdd: ['slate'], tagsRemove: ['bug'], assignedTo: 'kim', iteration: 'Web\\v3.0', area: 'acme/web/billing', description: 'Shorter.' } });
  const patch = srv.data.writes.find(w => w[0] === 'PATCH issue')[3];
  assert.equal(patch.title, 'Fix login');
  assert.deepEqual(patch.labels.sort(), ['P1', 'area: billing', 'slate']);
  assert.deepEqual(patch.assignees, ['kim']);
  assert.equal(patch.milestone, 2);
  assert.equal(patch.body, 'Shorter.\n\n## Repro steps\n\n1. Open login\n2. Wait\n\n## Acceptance criteria\n\n- No timeout');
  assert.equal(out.title, 'Fix login');
  assert.equal(out.iteration, 'v3.0');
  assert.equal(out.area, 'acme/web/billing');
  await assert.rejects(updateItem(d, { ...C, id: 1, rev: before.rev, changes: { title: 'x' } }), e => e.code === 'conflict');
  const res = await updateItem(d, { ...C, id: 1, changes: { state: 'Resolved' } });
  assert.equal(res.state, 'Resolved');
  assert.ok(res.tags.includes('resolved'));
  const closed = await updateItem(d, { ...C, id: 1, changes: { state: 'Removed' } });
  assert.equal(closed.state, 'Closed');
  assert.equal(srv.data.writes.filter(w => w[0] === 'PATCH issue').pop()[3].state_reason, 'not_planned');
  assert.ok(!closed.tags.includes('resolved'));
  await updateItem(d, { ...C, id: 2, changes: { comment: 'Questions?', related: [40, 2] } });
  assert.equal(srv.data.writes.filter(w => w[0] === 'POST comment').pop()[3].body, 'Questions?\n\nRelated: #40');
  await assert.rejects(updateItem(d, { ...C, id: 2, changes: { assignedTo: 'kim@example.com' } }), /login/);
  await assert.rejects(updateItem(d, { ...C, id: 2, changes: { targetDate: '2026-12-01' } }), /no start or target date/);
  await assert.rejects(updateItem(d, { ...C, id: 2, changes: { iteration: 'v9' } }), /no milestone "v9"/);
  const ms = await updateItem(d, { ...C, id: -2, changes: { title: 'v3.0.0', targetDate: '2027-01-15' } });
  assert.equal(ms.title, 'v3.0.0');
  assert.equal(srv.data.writes.find(w => w[0] === 'PATCH milestone')[3].due_on, '2027-01-15T00:00:00Z');
}));

test('workitem.create: an issue with type label, sections and sub-issue parent; an Epic is a milestone', () => withD(async (d, srv) => {
  const epic = await createItem(d, { ...C, type: 'Epic', title: 'v4.0', fields: { description: 'Big one' } });
  assert.equal(epic.type, 'Epic');
  assert.ok(epic.id < 0);
  const f = await createItem(d, { ...C, type: 'Feature', title: 'Exports', parent: epic.id, fields: { description: 'CSV out', area: 'acme/web/reports', tags: ['slate'], custom: { 'Custom.ReleaseNotes': 'Export to CSV.' } } });
  const post = srv.data.writes.find(w => w[0] === 'POST issue')[3];
  assert.deepEqual(post.labels.sort(), ['area: reports', 'feature', 'slate']);
  assert.equal(post.milestone, -epic.id);
  assert.equal(post.body, 'CSV out\n\n## Release note\n\nExport to CSV.');
  assert.equal(f.type, 'Feature');
  const s = await createItem(d, { ...C, type: 'User Story', title: 'Pick columns', parent: f.id, fields: { description: 'As a user', acceptance: '- columns' } });
  assert.equal(s.type, 'User Story');
  const sub = srv.data.writes.find(w => w[0] === 'POST sub_issue');
  assert.equal(sub[2], f.id);
  assert.ok(sub[3].sub_issue_id > 0);
  await assert.rejects(createItem(d, { ...C, type: 'Bug', title: ' ' }), /title/);
}));

test('iterations on a repo: open milestones, the next one due is current', () => withD(async d => {
  const r = await repoIterations(d, C);
  assert.deepEqual(r.iterations.map(i => [i.name, i.finish, i.current]), [['v2.1', '2026-12-15', true], ['v3.0', null, false]]);
}));
