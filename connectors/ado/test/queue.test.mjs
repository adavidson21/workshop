// Queue actions: queue.list, workitem.get additions, workitem.states, iterations.list, and the write actions
// workitem.update, workitem.comment and workitem.create, against the fake ADO server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMockAgent } from '../../../tests/mock-agent.mjs';
import { post } from '../../../tests/contract/helpers.mjs';
import ado from '../index.mjs';
import { normalize } from '../lib/config.mjs';
import { iterationsList, queueList, workitemStates } from '../lib/queue.mjs';
import { getWorkItem } from '../lib/workitem.mjs';
import { commentWorkItem, createWorkItem, mergeTags, patchOps, textToHtml, updateWorkItem, writeCheck } from '../lib/write.mjs';
import { startFakeAdo } from './fake-ado.mjs';
import { PAT, queueScenario } from './fixtures/queue.mjs';
import { REPO } from './harness.mjs';

const configFor = url => ({
  connections: [
    { name: 'main', serverUrl: url, collection: 'Main', project: 'Web App', patEnv: 'TEST_ADO_PAT' },
    { name: 'ro', serverUrl: url, collection: 'ReadOnly', project: 'Web App', patEnv: 'TEST_ADO_PAT' }
  ],
  defaultConnection: 'main'
});

async function withAdo(fn) {
  const srv = await startFakeAdo(queueScenario());
  const { config } = normalize(configFor(srv.url));
  const d = { cfg: config, env: name => (name === 'TEST_ADO_PAT' ? PAT : undefined) };
  try {
    return await fn({ d, srv });
  } finally {
    await srv.close();
  }
}

const TEAM_A = 'Web App\\Team A';

test('queue.list returns open items in the areas, in the queue shape, with who I am', () => withAdo(async ({ d, srv }) => {
  const out = await queueList(d, { areas: [TEAM_A] });
  assert.equal(out.connection, 'main');
  assert.deepEqual(out.items.map(i => i.id), [501, 502, 503]);
  assert.deepEqual(out.me, { name: 'Engineer A', email: 'engineer.a@example.com' });
  assert.equal(out.truncated, false);
  const bug = out.items[0];
  assert.deepEqual(bug, {
    id: 501, rev: 4, type: 'Bug', title: 'Synthetic bug 501', state: 'Active', reason: '',
    assignee: { name: 'Engineer A', email: 'engineer.a@example.com' }, priority: 1,
    iteration: 'Web App\\Sprint 12', area: TEAM_A, project: 'Web App', tags: ['api', 'urgent'],
    created: '2026-10-01T09:00:00Z', changed: '2026-10-14T15:30:00Z', stateChanged: '2026-10-05T10:00:00Z',
    connection: 'main', url: `${srv.url}/Main/Web%20App/_workitems/edit/501`
  });
  assert.equal(out.items[1].assignee, null);
  const wiql = srv.requests.find(r => r.includes('wit/wiql'));
  assert.match(wiql, /\[System\.WorkItemType\] IN \('Issue', 'Bug', 'User Story'\)/);
  assert.match(wiql, /\[System\.State\] NOT IN \('Resolved', 'Closed', 'Done', 'Removed'\)/);
}));

test('queue.list: several areas, closed items, changedSince, types', () => withAdo(async ({ d, srv }) => {
  assert.deepEqual((await queueList(d, { areas: [TEAM_A, 'Web App\\Team B'] })).items.map(i => i.id), [501, 502, 503, 504]);
  assert.deepEqual((await queueList(d, { areas: [TEAM_A], includeClosed: true })).items.map(i => i.id), [501, 502, 503, 510]);
  assert.deepEqual((await queueList(d, { areas: [TEAM_A], changedSince: '2026-10-10' })).items.map(i => i.id), [501]);
  await queueList(d, { areas: [TEAM_A], types: ['Bug'] });
  assert.match(srv.requests.filter(r => r.includes('wit/wiql')).pop(), /IN \('Bug'\)/);
}));

test('queue.list refuses missing or unsafe area paths and bad dates', () => withAdo(async ({ d }) => {
  await assert.rejects(queueList(d, { areas: [] }), /area path/);
  await assert.rejects(queueList(d, { areas: ["Web App' OR 1=1"] }), e => e.code === 'bad_request');
  await assert.rejects(queueList(d, { areas: [TEAM_A], changedSince: "2026' OR" }), e => e.code === 'bad_request');
}));

test('workitem.get keeps its old shape and adds comments, history, PRs and raw HTML only when asked', () => withAdo(async ({ d }) => {
  const plain = await getWorkItem(d, { id: 501, details: true });
  for (const k of ['comments', 'history', 'html', 'pullRequests']) assert.equal(k in plain, false, k);
  assert.equal(plain.description, 'Steps one\nalert(1)');
  const full = await getWorkItem(d, { id: 501, details: true, html: true, pullRequests: true, comments: true, history: true });
  assert.equal(full.html.description, '<p>Steps <b>one</b></p><script>alert(1)</script>');
  assert.deepEqual(full.pullRequests, [{ id: 77, repositoryId: 'r-1' }]);
  assert.deepEqual(full.comments.map(c => [c.id, c.text, c.by.name, c.edited]), [[1, 'First', 'Engineer A', true], [2, 'Second', 'Dev One', false]]);
  assert.match(full.comments[1].html, /onerror/, 'raw HTML is passed on for the app to sanitize');
  assert.deepEqual(full.history.map(h => h.rev), [4, 2, 1]);
  assert.deepEqual(full.history[0].changes, [{ field: 'state', from: 'New', to: 'Active' }, { field: 'priority', from: 2, to: 1 }]);
  assert.deepEqual(full.history[1].changes, [{ field: 'assignee', from: null, to: 'Engineer A' }]);
}));

test('comments use the preview API version of the connection', () => withAdo(async ({ d, srv }) => {
  await getWorkItem(d, { id: 501, comments: true });
  assert.ok(srv.requests.some(r => /Web%20App\/_apis\/wit\/workItems\/501\/comments\?\$top=200&api-version=6\.0-preview\.3/.test(r)));
}));

test('workitem.states and iterations.list', () => withAdo(async ({ d }) => {
  const s = await workitemStates(d, { type: 'User Story' });
  assert.deepEqual(s.states.map(x => x.name), ['New', 'Active', 'Closed']);
  assert.equal(s.project, 'Web App');
  const it = await iterationsList(d, {}, new Date('2026-10-15T12:00:00Z'));
  assert.deepEqual(it.iterations.map(i => [i.path, i.current]), [
    ['Web App', false], ['Web App\\Sprint 11', false], ['Web App\\Sprint 12', true], ['Web App\\Backlog', false]
  ]);
  assert.equal(it.iterations[2].start, '2026-10-07');
}));

test('patchOps and mergeTags', () => {
  assert.equal(mergeTags('api; urgent', ['UI', 'API'], ['Urgent']), 'api; UI');
  assert.equal(mergeTags('', ['a;b']), 'a b');
  assert.deepEqual(patchOps({ state: 'Active', assignedTo: '', priority: 2 }), [
    { op: 'add', path: '/fields/System.State', value: 'Active' },
    { op: 'add', path: '/fields/System.AssignedTo', value: '' },
    { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: 2 }
  ]);
  assert.throws(() => patchOps({ state: ' ' }), /State/);
  assert.equal(textToHtml('<b>hi</b>\n"x" & \'y\''), '&lt;b&gt;hi&lt;/b&gt;<br>&quot;x&quot; &amp; &#39;y&#39;');
});

test('workitem.update changes each field with a revision test and returns the new item', () => withAdo(async ({ d, srv }) => {
  const out = await updateWorkItem(d, { id: 501, rev: 4, changes: { state: 'Resolved', assignedTo: 'dev.one@example.com', priority: 3, iteration: 'Web App\\Sprint 11', tagsAdd: ['ui'], tagsRemove: ['urgent'] } });
  assert.equal(out.rev, 5);
  assert.equal(out.state, 'Resolved');
  assert.equal(out.priority, 3);
  assert.equal(out.iteration, 'Web App\\Sprint 11');
  assert.deepEqual(out.tags, ['api', 'ui']);
  const patch = srv.requests.find(r => r.startsWith('PATCH'));
  assert.match(patch, /^PATCH \/Main\/_apis\/wit\/workitems\/501\?api-version=6\.0 \[\{"op":"test","path":"\/rev","value":4\}/);
}));

test('workitem.update with a stale revision is a conflict and changes nothing', () => withAdo(async ({ d, srv }) => {
  await assert.rejects(updateWorkItem(d, { id: 501, rev: 3, changes: { state: 'Closed' } }), e => e.code === 'conflict' && e.status === 409 && e.current.rev === 4);
  assert.equal(srv.requests.filter(r => r.startsWith('PATCH')).length, 0);
}));

test('workitem.update: a rev test that fails at ADO (changed between read and write) is a conflict too', () => withAdo(async ({ d, srv }) => {
  // Change the item behind the connector's back between its read and its write.
  const realCall = (await import('../lib/client.mjs')).Ado.prototype.call;
  const proto = (await import('../lib/client.mjs')).Ado.prototype;
  proto.call = async function (method, p, o) {
    if (method === 'PATCH' && !this._bumped) {
      this._bumped = true;
      await realCall.call(this, 'PATCH', p, { body: [{ op: 'add', path: '/fields/System.Title', value: 'Changed by someone else' }], contentType: 'application/json-patch+json' });
    }
    return realCall.call(this, method, p, o);
  };
  try {
    await assert.rejects(updateWorkItem(d, { id: 501, rev: 4, changes: { state: 'Closed' } }), e => e.code === 'conflict' && e.current.title === 'Changed by someone else');
  } finally {
    proto.call = realCall;
  }
  assert.equal(srv.requests.filter(r => r.startsWith('PATCH')).length, 2);
}));

test('a read-only PAT gets a message naming the write scope', () => withAdo(async ({ d }) => {
  await assert.rejects(updateWorkItem(d, { connection: 'ro', id: 601, rev: 1, changes: { state: 'Active' } }), /Work Items \(Read & Write\)/);
  await assert.rejects(commentWorkItem(d, { connection: 'ro', id: 601, text: 'hi' }), /Work Items \(Read & Write\)/);
}));

test('workitem.comment escapes plain text and posts it to the comments API', () => withAdo(async ({ d, srv }) => {
  const out = await commentWorkItem(d, { id: 501, text: 'Looks good <script>x</script>\nthanks' });
  assert.equal(out.comment.text, 'Looks good <script>x</script>\nthanks');
  const req = srv.requests.find(r => r.startsWith('POST') && r.includes('/comments'));
  assert.match(req, /Web%20App\/_apis\/wit\/workItems\/501\/comments\?api-version=6\.0-preview\.3 \{"text":"Looks good &lt;script&gt;x&lt;\/script&gt;<br>thanks"\}/);
  await assert.rejects(commentWorkItem(d, { id: 501, text: '   ' }), /Write a comment/);
}));

test('workitem.create builds the item, puts a bug description in repro steps', () => withAdo(async ({ d, srv }) => {
  const out = await createWorkItem(d, { type: 'Bug', title: 'New synthetic bug', description: 'a < b', area: TEAM_A, iteration: 'Web App\\Sprint 12', priority: 2, assignedTo: 'dev.one@example.com' });
  assert.equal(out.id, 9000);
  assert.equal(out.title, 'New synthetic bug');
  assert.equal(out.state, 'New');
  assert.equal(out.area, TEAM_A);
  const req = srv.requests.find(r => r.startsWith('POST') && r.includes('$Bug'));
  assert.match(req, /Microsoft\.VSTS\.TCM\.ReproSteps","value":"a &lt; b"/);
  const story = await createWorkItem(d, { type: 'User Story', title: 'Story', description: 'x' });
  assert.equal(story.type, 'User Story');
  assert.ok(srv.requests.some(r => r.includes('System.Description')));
  await assert.rejects(createWorkItem(d, { type: 'Bug', title: ' ' }), /title/);
}));

test('writeCheck proves writes and the server revision check, then removes its tag', () => withAdo(async ({ d }) => {
  const out = await writeCheck(d, 502);
  assert.deepEqual(out.steps, [
    'Added a tag: the PAT can write work items.',
    'ADO refused a write with an old revision: the revision check works.',
    'Removed the tag again.',
    'The comments API answered (api-version 6.0-preview.3).'
  ]);
  const after = await getWorkItem(d, { id: 502, details: true });
  assert.equal(after.tags, '');
}));

test('module: write actions are marked write, reads are not', () => {
  const writes = Object.entries(ado.actions).filter(([, a]) => a.write).map(([k]) => k).sort();
  assert.deepEqual(writes, ['workitem.comment', 'workitem.create', 'workitem.update']);
});

test('through the agent: write actions need confirm, and a conflict comes back as 409 conflict', async () => {
  const srv = await startFakeAdo(queueScenario());
  const cfg = { configVersion: 1, connectors: { ado: { enabled: true, config: configFor(srv.url) } } };
  const agent = await createMockAgent({ connectorsDir: path.join(REPO, 'connectors'), appsDir: path.join(REPO, 'tests', 'fixtures', 'apps'), env: { TEST_ADO_PAT: PAT }, config: cfg, log: () => {} });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-queue-'));
  try {
    const list = await post(agent, '/api/connectors/ado/queue.list', { args: { areas: [TEAM_A] } });
    assert.equal(list.status, 200);
    assert.equal(list.json.result.items.length, 3);
    const noConfirm = await post(agent, '/api/connectors/ado/workitem.update', { args: { id: 501, rev: 4, changes: { state: 'Closed' } } });
    assert.equal(noConfirm.status, 400);
    assert.equal(noConfirm.json.code, 'confirm_required');
    const stale = await post(agent, '/api/connectors/ado/workitem.update', { args: { id: 501, rev: 1, changes: { state: 'Closed' } }, confirm: true });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.code, 'conflict');
    const ok = await post(agent, '/api/connectors/ado/workitem.update', { args: { id: 501, rev: 4, changes: { state: 'Closed' } }, confirm: true });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.result.state, 'Closed');
    const bad = await post(agent, '/api/connectors/ado/workitem.update', { args: { id: 501, rev: 5, changes: { owner: 'x' } }, confirm: true });
    assert.equal(bad.status, 400);
    assert.equal(srv.requests.some(r => r.includes(PAT)), false);
  } finally {
    await agent.stop();
    await srv.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('doctor --write-check prints plain-word steps and no titles', async () => {
  const { main } = await import('../doctor.mjs');
  const srv = await startFakeAdo(queueScenario());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-wc-'));
  const file = path.join(dir, 'ado.json');
  fs.writeFileSync(file, JSON.stringify(configFor(srv.url)));
  const lines = [];
  try {
    const code = await main(['--config', file, '--write-check', '502'], { out: s => lines.push(s), env: { TEST_ADO_PAT: PAT } });
    assert.equal(code, 0, lines.join('\n'));
    assert.ok(lines.includes('Result: writes work.'));
    assert.equal(lines.join('\n').includes('Synthetic'), false);
    assert.equal(await main(['--write-check'], { out: s => lines.push(s), env: {} }), 1);
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
