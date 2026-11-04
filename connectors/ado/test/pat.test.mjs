// PAT onboarding and upkeep: live status (a PAT saved while Workshop runs counts at once), expiry warnings
// from "PAT expires", a rejected PAT until a new one is saved, setup actions and importing one file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ado, { configSchema } from '../index.mjs';
import { normalize } from '../lib/config.mjs';
import { importFile } from '../lib/import.mjs';
import { authTracker, daysLeft, patHint, patStatus } from '../lib/pat.mjs';
import { startFakeAdo } from './fake-ado.mjs';
import { PAT, scenario } from './fixtures/team.mjs';
import { start as startReal } from '../../../agent/test-target.mjs';
import { createMockAgent } from '../../../tests/mock-agent.mjs';
import { post, get } from '../../../tests/contract/helpers.mjs';
import { REPO } from './harness.mjs';
import { SchemaSet } from '../../../agent/lib/schema.mjs';

const conn = (over = {}) => ({ name: 'main', serverUrl: 'https://ado.example.com', collection: 'Main', patEnv: 'TEST_ADO_PAT', ...over });

test('daysLeft counts whole days to the last day the PAT works', () => {
  const now = new Date(2026, 10, 2, 23, 15); // Nov 2, local time
  assert.equal(daysLeft('2026-11-02', now), 0);
  assert.equal(daysLeft('2026-11-16', now), 14);
  assert.equal(daysLeft('2026-11-01', now), -1);
  assert.equal(daysLeft('2027-01-01', now), 60);
  assert.equal(daysLeft('', now), null);
  assert.equal(daysLeft('2026-02-30', now), null);
  assert.equal(daysLeft('soon', now), null);
});

test('patHint says how to save a PAT on each platform', () => {
  assert.equal(patHint('ADO_PAT', 'win32'), 'Save it with: workshop pat ADO_PAT');
  assert.match(patHint('ADO_PAT', 'darwin'), /shell profile.*workshop restart/);
});

test('patStatus: missing, expiring, expired and rejected, in that order of importance', () => {
  const now = new Date(2026, 10, 2);
  const cfg = normalize({ connections: [conn({ patExpires: '2026-11-10' }), conn({ name: 'other', patEnv: 'OTHER_PAT' })] }).config;
  const read = env => name => env[name];

  const missing = patStatus(cfg, read({ TEST_ADO_PAT: 'x'.repeat(30) }), [], { now, platform: 'win32' });
  assert.equal(missing.state, 'error');
  assert.equal(missing.message, 'OTHER_PAT is not set. Save it with: workshop pat OTHER_PAT');
  assert.deepEqual(missing.details.patsMissing, ['OTHER_PAT']);

  const both = read({ TEST_ADO_PAT: 'x'.repeat(30), OTHER_PAT: 'y'.repeat(30) });
  const soon = patStatus(cfg, both, [], { now, platform: 'win32' });
  assert.equal(soon.state, 'ready');
  assert.equal(soon.message, 'The PAT in TEST_ADO_PAT expires in 8 days (2026-11-10). Make a new one in ADO, save it with: workshop pat TEST_ADO_PAT, and update "PAT expires" in Settings.');
  assert.deepEqual(soon.details.patsExpiring, [{ patEnv: 'TEST_ADO_PAT', connection: 'main', expires: '2026-11-10', days: 8 }]);

  const later = patStatus(cfg, both, [], { now: new Date(2026, 9, 1), platform: 'win32' });
  assert.equal(later.message, null);
  assert.equal(later.details.patsExpiring, undefined);

  const gone = patStatus(cfg, both, [], { now: new Date(2026, 10, 12), platform: 'win32' });
  assert.match(gone.message, /expired on 2026-11-10/);

  const rejected = patStatus(cfg, both, [{ patEnv: 'OTHER_PAT', at: '2026-11-02T10:00:00.000Z' }], { now, platform: 'win32' });
  assert.equal(rejected.state, 'ready'); // calls still go through, so a new PAT works at once
  assert.match(rejected.message, /^ADO rejected the PAT in OTHER_PAT\. .* save it with: workshop pat OTHER_PAT\.$/);
});

test('authTracker keeps a 401 until the variable holds a new value or a call succeeds; 403 is not a bad PAT', () => {
  const env = { A: 'old-token-aaaaaaaaaaaaaaaa' };
  const read = n => env[n];
  const t = authTracker();
  let changes = 0;
  t.onChange(() => changes++);
  const h = t.hooks(read);
  h.rejected('A', 403);
  assert.deepEqual(t.active(read), []);
  h.rejected('A', 401);
  h.rejected('A', 401);
  assert.equal(changes, 1);
  assert.equal(t.active(read).length, 1);
  assert.equal(JSON.stringify(t.active(read)).includes(env.A), false, 'never keeps the value');
  env.A = 'new-token-bbbbbbbbbbbbbbbb';
  assert.deepEqual(t.active(read), []);
  h.rejected('A', 401);
  h.ok('A');
  assert.deepEqual(t.active(read), []);
  assert.equal(changes, 3);
});

test('patExpires is optional in the schema and in normalize', () => {
  const schemas = SchemaSet.fromDir(path.join(REPO, 'docs', 'schemas'));
  const ok = schemas.validate(configSchema, { connections: [conn({ patExpires: '2027-02-01' })] });
  assert.deepEqual(ok, []);
  assert.notDeepEqual(schemas.validate(configSchema, { connections: [conn({ patExpires: 'Feb 1' })] }), []);
  assert.equal(normalize({ connections: [conn()] }).config.connections[0].patExpires, '');
  assert.equal(normalize({ connections: [conn({ patExpires: 'bad' })] }).config.connections[0].patExpires, '');
});

/** A ctx like the agent's, with an environment the test can change while the connector runs. */
function fakeCtx(config, env) {
  let statusCalls = 0;
  return {
    ctx: {
      config,
      env: name => env[name],
      log: { info() {}, warn() {}, error() {} },
      signal: new AbortController().signal,
      statusChanged: () => { statusCalls++; }
    },
    changed: () => statusCalls
  };
}

test('status follows the environment live and remembers a rejected PAT until a new one is saved', async () => {
  const srv = await startFakeAdo(scenario);
  const env = {};
  const { ctx, changed } = fakeCtx({ connections: [{ name: 'main', serverUrl: srv.url, collection: 'Main', project: 'Web App', patEnv: 'TEST_ADO_PAT' }] }, env);
  try {
    await ado.start(ctx);
    assert.equal(ado.status().state, 'error');
    assert.match(ado.status().message, /^TEST_ADO_PAT is not set\. /);

    env.TEST_ADO_PAT = 'wrong-token-0123456789abcd';
    assert.equal(ado.status().state, 'ready', 'saved while running: no restart');
    await assert.rejects(ado.actions['workitem.get'].run({ id: 101 }, ctx), e => e.upstream === 401);
    assert.equal(changed(), 1);
    assert.match(ado.status().message, /ADO rejected the PAT in TEST_ADO_PAT/);
    assert.equal(JSON.stringify(ado.status()).includes(env.TEST_ADO_PAT), false);

    env.TEST_ADO_PAT = PAT;
    assert.equal(ado.status().message, null, 'a new value clears it');
    const w = await ado.actions['workitem.get'].run({ id: 101 }, ctx);
    assert.equal(w.id, 101);
  } finally {
    await ado.stop();
    await srv.close();
  }
  assert.equal(ado.status().state, 'stopped');
});

test('a 401 error says how to save a new PAT; a 403 keeps the helper\'s wording', async () => {
  const srv = await startFakeAdo(scenario);
  const { ctx } = fakeCtx({ connections: [{ name: 'main', serverUrl: srv.url, collection: 'Main', patEnv: 'TEST_ADO_PAT' }] }, { TEST_ADO_PAT: 'wrong-token-0123456789abcd' });
  try {
    await ado.start(ctx);
    await assert.rejects(ado.actions['workitem.get'].run({ id: 101 }, ctx), e => /HTTP 401\).*If you made a new one, (save it with: workshop pat|set) TEST_ADO_PAT/.test(e.message));
  } finally { await ado.stop(); await srv.close(); }
});

test('connection.resolve, config.import and config.fromUrl are setup actions; the others are not', () => {
  const setup = Object.entries(ado.actions).filter(([, a]) => a.setup === true).map(([n]) => n).sort();
  assert.deepEqual(setup, ['config.fromUrl', 'config.import', 'connection.resolve']);
  for (const n of setup) assert.equal(ado.actions[n].write, false);
});

test('importFile recognizes an ado-helper.json and an eng-agents config.json, and refuses anything else', () => {
  const helper = importFile({ base_url: 'https://ado.example.com/tfs/Main', pat_env: 'ADO_PAT', pat: 'never-read' }, {});
  assert.equal(helper.config.connections[0].serverUrl, 'https://ado.example.com/tfs');
  assert.equal(helper.config.connections[0].collection, 'Main');
  assert.equal(JSON.stringify(helper).includes('never-read'), false);
  const eng = importFile({ connections: { work: { serverUrl: 'https://ado.example.com', collection: 'Main', project: 'Web App' } } }, {});
  assert.equal(eng.config.connections[0].name, 'work');
  const nested = importFile({ ado: { serverUrl: 'https://ado.example.com', collection: 'Main' } }, {});
  assert.equal(nested.config.connections.length, 1);
  assert.throws(() => importFile({ hello: 1 }, {}), e => e.code === 'bad_request');
  assert.throws(() => importFile([], {}), e => e.code === 'bad_request');
});

test('through both agents: config.import runs before any connection exists', async () => {
  const dirs = { connectorsDir: path.join(REPO, 'connectors'), appsDir: path.join(REPO, 'tests', 'fixtures', 'apps') };
  const cfg = { configVersion: 1, connectors: { ado: { enabled: true, config: { connections: [] } } } };
  for (const kind of ['mock', 'real']) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-ado-pat-'));
    const agent = kind === 'mock'
      ? await createMockAgent({ ...dirs, env: {}, config: cfg, log: () => {} })
      : await startReal({ ...dirs, home, env: {}, config: cfg });
    try {
      const info = (await get(agent, '/api/connectors/ado')).json;
      assert.equal(info.status.state, 'error', kind);
      assert.equal(info.actions.find(a => a.name === 'config.import').setup, true, kind);
      const sync = await post(agent, '/api/connectors/ado/sync', {});
      assert.equal(sync.status, 503, kind);
      const r = await post(agent, '/api/connectors/ado/config.import', { args: { file: { base_url: 'https://ado.example.com/Main' } } });
      assert.equal(r.status, 200, `${kind}: ${JSON.stringify(r.json)}`);
      assert.equal(r.json.result.config.connections[0].collection, 'Main', kind);
    } finally {
      await agent.stop();
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
});
