// The ADO connector through the agent API (mock agent and real agent), plus its config, import and safety rules.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMockAgent } from '../../../tests/mock-agent.mjs';
import { start as startReal } from '../../../agent/test-target.mjs';
import { post, get, expectJson, expectError, schemas } from '../../../tests/contract/helpers.mjs';
import ado, { configSchema } from '../index.mjs';
import { normalize, resolveConnection, pathKey } from '../lib/config.mjs';
import { importConfig, splitBase } from '../lib/import.mjs';
import { htmlToText } from '../lib/workitem.mjs';
import { Ado } from '../lib/client.mjs';
import { startFakeAdo } from './fake-ado.mjs';
import { PAT, scenario } from './fixtures/team.mjs';
import { REPO } from './harness.mjs';

const configFor = url => ({
  connections: [
    { name: 'main', serverUrl: url, collection: 'Main', project: 'Web App', patEnv: 'TEST_ADO_PAT' },
    { name: 'apps', serverUrl: url, collection: 'Apps', patEnv: 'TEST_ADO_PAT' }
  ],
  defaultConnection: 'main',
  paths: [
    { path: 'C:\\src\\work\\*', connection: 'main' },
    { path: 'C:/src/work/field-*', connection: 'apps', project: 'Field' }
  ],
  prSources: [{ connection: 'main', project: 'Web App', repos: [] }]
});

/**
 * Runs fn once against the mock agent and once against the real agent (WS1), each with ADO enabled and
 * pointed at the fake server. fn gets {agent, srv, logs, kind}; logs() returns the log lines so far.
 */
async function withAgent(fn, { env = { TEST_ADO_PAT: PAT }, config } = {}) {
  for (const kind of ['mock', 'real']) {
    const srv = await startFakeAdo(scenario);
    const cfg = { configVersion: 1, connectors: { ado: { enabled: true, config: config || configFor(srv.url) } } };
    const dirs = { connectorsDir: path.join(REPO, 'connectors'), appsDir: path.join(REPO, 'tests', 'fixtures', 'apps') };
    const lines = [];
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-ado-'));
    let agent;
    if (kind === 'mock') {
      agent = await createMockAgent({ ...dirs, env, config: cfg, log: (who, level, msg) => lines.push(`${who} ${level} ${msg}`) });
    } else {
      agent = await startReal({ ...dirs, home, env, config: cfg });
    }
    const logs = () => (kind === 'mock' ? lines : fs.existsSync(path.join(home, 'logs'))
      ? fs.readdirSync(path.join(home, 'logs')).map(f => fs.readFileSync(path.join(home, 'logs', f), 'utf8')) : []);
    try {
      await fn({ agent, srv, logs, kind });
    } catch (e) {
      e.message = `[${kind} agent] ${e.message}`;
      throw e;
    } finally {
      await agent.stop();
      await srv.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
}

const call = (agent, action, args, extra = {}) => post(agent, `/api/connectors/ado/${action}`, { args, ...extra });

test('module follows the connector contract and its configSchema fits the settings form', () => {
  assert.equal(ado.id, 'ado');
  assert.deepEqual(schemas.validate('config-form', configSchema), []);
  for (const a of Object.values(ado.actions)) assert.equal(a.write, false, 'every ADO action is read-only');
  assert.equal(ado.test.action, 'workitem.get');
});

test('the C0 example settings are accepted', async () => {
  const example = (await import('node:fs')).readFileSync(path.join(REPO, 'docs/examples/connector-config-put.ado.json'), 'utf8');
  const cfg = JSON.parse(example).config;
  // The example also carries Prioritizer settings (syncMinutes, reviewNewItems, prTiers) that live in the app.
  for (const k of ['syncMinutes', 'reviewNewItems', 'prTiers']) delete cfg[k];
  assert.deepEqual(schemas.validate(configSchema, cfg), []);
  assert.deepEqual(normalize(cfg).problems, []);
});

test('workitem.get returns title, type, project and the connection used', async () => {
  await withAgent(async ({ agent }) => {
    const res = expectJson(await call(agent, 'workitem.get', { id: 101 }), 200, 'connector-call-response');
    assert.deepEqual(res.result, {
      id: 101, title: "Fix the user's renewal timeout", type: 'Bug', state: 'Active', project: 'Web App',
      connection: 'main', reason: 'default connection', url: res.result.url
    });
    assert.match(res.result.url, /\/Main\/Web%20App\/_workitems\/edit\/101$/);
  });
});

test('workitem.get picks the connection from a repo path and can include details', async () => {
  await withAgent(async ({ agent }) => {
    const res = expectJson(await call(agent, 'workitem.get', { id: 101, path: 'c:\\SRC\\work\\web-api', details: true }), 200);
    assert.equal(res.result.connection, 'main');
    assert.equal(res.result.reason, 'path matches C:\\src\\work\\*');
    assert.equal(res.result.description, 'Renewal times out after 30s.\n\n- Step one\n- Step two & three');
    assert.equal(res.result.acceptanceCriteria, 'Renewal finishes in under 5s.');
    assert.deepEqual(res.result.related, [{ name: 'Parent', id: 90 }]);
  });
});

test('workitem.get says plainly when the item does not exist', async () => {
  await withAgent(async ({ agent }) => {
    const err = expectError(await call(agent, 'workitem.get', { id: 999 }), 404, 'not_found');
    assert.match(err.error, /Work item 999 was not found on connection "main"/);
  });
});

test('the settings Test field works through the agent (connector info and argsSchema)', async () => {
  await withAgent(async ({ agent }) => {
    const info = expectJson(await get(agent, '/api/connectors/ado'), 200, 'connector-info');
    assert.equal(info.status.state, 'ready');
    assert.deepEqual(info.test, { action: 'workitem.get', arg: 'id', label: 'Work item ID' });
    expectError(await call(agent, 'workitem.get', { id: 'abc' }), 400, 'bad_request');
  });
});

test('sync, sync.prs and dataset run through the agent', async () => {
  await withAgent(async ({ agent }) => {
    const s = expectJson(await call(agent, 'sync', { known: [101, '201', 'x', -1] }), 200).result;
    assert.deepEqual(s.items.map(i => i.id), [101, 102, 103]);
    assert.deepEqual(s.gone.map(g => [g.id, g.reason]), [[201, 'closed']]);
    assert.ok(s.prs.items.length > 0);
    const p = expectJson(await call(agent, 'sync.prs', {}), 200).result;
    assert.deepEqual(p.items.map(i => i.id), s.prs.items.map(i => i.id));
    const d = expectJson(await call(agent, 'dataset', { connection: 'main', areas: ['Web App\\Team A'] }), 200).result;
    assert.equal(d.connection, 'main');
    assert.equal(d.items.length, 4);
  });
});

test('dataset refuses a collection that is not configured', async () => {
  await withAgent(async ({ agent }) => {
    const err = expectError(await call(agent, 'dataset', { base: 'https://elsewhere.example.com/X', people: ['a@example.com'] }), 400, 'bad_request');
    assert.match(err.error, /not one of your ADO connections/);
    expectError(await call(agent, 'dataset', { connection: 'nope', people: ['a@example.com'] }), 400, 'bad_request');
  });
});

test('connection.resolve shows the mapping without calling ADO', async () => {
  await withAgent(async ({ agent, srv }) => {
    const before = srv.requests.length;
    const r = expectJson(await call(agent, 'connection.resolve', { path: 'C:/src/work/field-app/src' }), 200).result;
    assert.deepEqual({ c: r.connection, p: r.project, set: r.patSet, env: r.patEnv }, { c: 'apps', p: 'Field', set: true, env: 'TEST_ADO_PAT' });
    assert.equal(srv.requests.length, before);
  });
});

test('the PAT is never logged, returned, or put in an error', async () => {
  const seen = [];
  await withAgent(async ({ agent, logs }) => {
    for (const [action, args] of [['sync', { known: [205] }], ['workitem.get', { id: 101 }], ['workitem.get', { id: 999 }],
      ['dataset', { people: ['dev.one@example.com'] }], ['connection.resolve', {}]]) {
      seen.push((await call(agent, action, args)).text);
    }
    seen.push((await get(agent, '/api/connectors/ado/config')).text, (await get(agent, '/api/connectors/ado')).text, ...logs());
  });
  // Wrong PAT: ADO says 401, the message names the scope, never the value.
  await withAgent(async ({ agent, logs }) => {
    const res = await call(agent, 'workitem.get', { id: 101 });
    expectError(res, 503, 'unavailable');
    assert.match(res.json.error, /ADO rejected the PAT \(HTTP 401\)/);
    seen.push(res.text, ...logs());
  }, { env: { TEST_ADO_PAT: 'wrong-pat-value-xyz' } });
  const all = seen.join('\n');
  const b64 = Buffer.from(':' + PAT).toString('base64');
  for (const secret of [PAT, b64, 'wrong-pat-value-xyz', Buffer.from(':wrong-pat-value-xyz').toString('base64')]) {
    assert.ok(!all.includes(secret), 'secret leaked');
  }
});

test('a missing PAT puts the connector in error, naming the variable only', async () => {
  await withAgent(async ({ agent }) => {
    const info = expectJson(await get(agent, '/api/connectors/ado'), 200, 'connector-info');
    assert.equal(info.status.state, 'error');
    assert.match(info.status.message, /^TEST_ADO_PAT is not set/);
    expectError(await call(agent, 'workitem.get', { id: 101 }), 503, 'unavailable');
  }, { env: {} });
});

test('bad settings put the connector in error with plain words', async () => {
  await withAgent(async ({ agent }) => {
    const info = expectJson(await get(agent, '/api/connectors/ado'), 200);
    assert.equal(info.status.state, 'error');
    assert.match(info.status.message, /default connection "nope"/);
  }, { config: { connections: [{ name: 'a', serverUrl: 'https://ado.example.com', collection: 'C', patEnv: 'TEST_ADO_PAT' }], defaultConnection: 'nope' } });
});

test('connection choice follows eng-agents order', () => {
  const { config } = normalize({
    connections: [
      { name: 'one', serverUrl: 'https://a.example.com', collection: 'A', patEnv: 'X' },
      { name: 'two', serverUrl: 'https://a.example.com/', collection: '/B/', patEnv: 'X' }
    ],
    paths: [{ path: '~/src/*', connection: 'one' }, { path: '~/src/legacy-*', connection: 'two' }]
  });
  assert.equal(config.connections[1].base, 'https://a.example.com/B');
  const home = 'C:\\Users\\me';
  assert.equal(pathKey('~\\src\\Thing\\', home), 'c:/users/me/src/thing');
  assert.equal(resolveConnection(config, { path: 'C:/Users/me/src/legacy-api', home }).connection.name, 'two');
  assert.equal(resolveConnection(config, { path: 'C:/Users/me/src/new-api', home }).connection.name, 'one');
  assert.equal(resolveConnection(config, { connection: 'two', path: 'C:/Users/me/src/new-api', home }).connection.name, 'two');
  assert.throws(() => resolveConnection(config, { path: 'D:/other', home }), /Could not tell which ADO connection/);
  const single = normalize({ connections: [{ name: 'solo', serverUrl: 'https://a.example.com', collection: 'A', patEnv: 'X' }] }).config;
  assert.equal(resolveConnection(single, {}).reason, 'only connection');
});

test('import turns ado-helper.json and eng-agents config.json into valid settings', () => {
  const engAgents = {
    apiVersion: '6.0', auth: 'pat', default: 'main',
    connections: {
      main: { serverUrl: 'https://ado.example.com/tfs', collection: 'DefaultCollection', project: 'Platform' },
      'second one': { serverUrl: 'https://ado.example.com/tfs', collection: 'SecondCollection', patEnv: 'ADO_PAT_SECOND', auth: 'windows' },
      sample: { serverUrl: 'https://ado.example.local/tfs', collection: 'X' }
    },
    paths: { 'C:/src/work/legacy-*': 'second one', 'C:/src/other': 'missing' }
  };
  const helper = {
    base_url: 'https://ado.example.com/tfs/DefaultCollection/', pat_env: 'MY_PAT', api_version: '6.0', port: 4791,
    types: ['Bug'], closed_states: ['Done'], removed_states: ['Removed'], allowed_origins: ['https://example.github.io'],
    verify_ssl: true, pr_sources: [{ base_url: 'https://ado.example.com/tfs/Apps', project: 'Mobile', repos: ['app'] }],
    pr_teams: ['Platform'], high_priorities: [1, 2, 3], effort_fields: ['Microsoft.VSTS.Scheduling.Effort'], workload_max_items: 900
  };
  const { config, notes } = importConfig({ helper, engAgents });
  assert.deepEqual(config.connections.map(c => [c.name, c.collection, c.patEnv]), [
    ['main', 'DefaultCollection', 'ADO_PAT'], ['second-one', 'SecondCollection', 'ADO_PAT_SECOND'], ['apps', 'Apps', 'MY_PAT']
  ]);
  assert.equal(config.defaultConnection, 'main');
  assert.equal(config.syncConnection, undefined);
  assert.deepEqual(config.paths, [{ path: 'C:/src/work/legacy-*', connection: 'second-one' }]);
  assert.deepEqual(config.prSources, [{ connection: 'apps', project: 'Mobile', repos: ['app'] }]);
  assert.deepEqual(config.reports, { highPriorities: ['1', '2', '3'], effortFields: ['Microsoft.VSTS.Scheduling.Effort'], maxItems: 900 });
  assert.deepEqual([config.types, config.closedStates, config.prTeams], [['Bug'], ['Done'], ['Platform']]);
  for (const want of [/example server URL/, /"missing" is not a connection/, /Windows sign-in/, /MY_PAT/, /allowed_origins/]) {
    assert.ok(notes.some(n => want.test(n)), `missing note ${want}`);
  }
  assert.deepEqual(schemas.validate(configSchema, config), []);
  assert.deepEqual(normalize(config).problems, []);
  assert.deepEqual(splitBase('https://h.example.com/tfs/Coll%20One/'), { serverUrl: 'https://h.example.com/tfs', collection: 'Coll One' });
});

test('config.import action returns settings and writes nothing', async () => {
  await withAgent(async ({ agent }) => {
    const r = expectJson(await call(agent, 'config.import', { helper: { base_url: 'https://ado.example.com/New', pat_env: 'ADO_PAT' } }), 200).result;
    assert.deepEqual(r.config.connections.map(c => c.name), ['main', 'apps', 'new']);
    const after = expectJson(await get(agent, '/api/connectors/ado/config'), 200);
    assert.equal(after.config.connections.length, 2);
  });
});

test('a redirect to a sign-in page is an error, not data', async () => {
  const srv = http.createServer((req, res) => { res.writeHead(302, { Location: '/signin' }); res.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const c = new Ado({ base: `http://127.0.0.1:${srv.address().port}/Main`, pat: PAT });
    await assert.rejects(c.call('GET', 'connectionData'), /sign-in page/);
  } finally {
    await new Promise(r => srv.close(r));
  }
});

test('an unreachable server gets a plain message', async () => {
  const c = new Ado({ base: 'http://127.0.0.1:1/Main', pat: PAT });
  await assert.rejects(c.call('GET', 'connectionData'), /Could not reach ADO at http:\/\/127\.0\.0\.1:1\/Main\. Are you on VPN\?/);
});

test('rich text becomes plain text', () => {
  assert.equal(htmlToText('<p>a&lt;b&gt;</p><table><tr><td>x</td><td>y</td></tr></table>&#39;q&#x27;'), "a<b>\nx | y |\n'q'");
  assert.equal(htmlToText(null), '');
});
