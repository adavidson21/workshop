// doctor.mjs: the --test equivalent, --compare (counts only, writes nothing) and --import.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { main, parseArgs } from '../doctor.mjs';
import { compareLists } from '../lib/compare.mjs';
import { PAT } from './fixtures/team.mjs';
import { HELPER, findPython, testEnv, withServer } from './harness.mjs';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-ado-doctor-'));
}

function listAll(dir) {
  return fs.readdirSync(dir, { recursive: true }).sort();
}

async function run(argv, env) {
  const lines = [];
  const code = await main(argv, { out: s => lines.push(s), env });
  return { code, text: lines.join('\n') };
}

test('parseArgs reads options and rejects unknown ones', () => {
  assert.deepEqual(parseArgs(['--compare', '--areas', 'A;B', '--days', '30']), { mode: 'compare', areas: 'A;B', days: '30' });
  assert.deepEqual(parseArgs(['--import', '--eng-agents-config', 'x.json', '--write']), { mode: 'import', engAgentsConfig: 'x.json', write: true });
  assert.throws(() => parseArgs(['--nope']), /Unknown option/);
  assert.throws(() => parseArgs(['--helper']), /needs a value/);
});

test('doctor checks each connection and lists what a sync finds', async () => {
  await withServer(async srv => {
    const dir = tmpdir();
    const file = path.join(dir, 'ado.json');
    fs.writeFileSync(file, JSON.stringify({
      connections: [
        { name: 'main', serverUrl: srv.url, collection: 'Main', patEnv: 'TEST_ADO_PAT' },
        { name: 'other', serverUrl: srv.url, collection: 'Main', patEnv: 'UNSET_PAT_FOR_TEST' }
      ],
      defaultConnection: 'main',
      prSources: [{ connection: 'main', project: 'Web App' }]
    }));
    const { code, text } = await run(['--config', file], testEnv());
    assert.equal(code, 1, 'the unset PAT makes it fail');
    assert.match(text, /main\s+http:\/\/127\.0\.0\.1:\d+\/Main\s+PAT from TEST_ADO_PAT \(set\)\n\s+Connected\./);
    assert.match(text, /PAT from UNSET_PAT_FOR_TEST \(NOT SET\)/);
    assert.match(text, /3 open work items assigned to you:\n  #101  Bug/);
    assert.match(text, /pull requests waiting on you:\n  PR 501    blocking \(last one\)/);
    assert.ok(!text.includes(PAT));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

const python = findPython();

test('--compare prints counts only and writes nothing', { skip: python ? false : 'Python 3 not found' }, async () => {
  await withServer(async srv => {
    const dir = tmpdir();
    const helper = path.join(dir, 'ado_helper.py');
    fs.copyFileSync(HELPER, helper);
    fs.writeFileSync(path.join(dir, 'ado-helper.json'), JSON.stringify({
      base_url: `${srv.url}/Main`, pat_env: 'TEST_ADO_PAT', pr_teams: ['platform'],
      pr_sources: [{ base_url: `${srv.url}/Main`, project: 'Web App', repos: [] }, { base_url: `${srv.url}/Apps`, project: 'Field', repos: ['field-app'] }]
    }));
    const before = listAll(dir);
    const py = [python.cmd, ...python.args].join(' ');
    const { code, text } = await run(['--compare', '--helper', helper, '--python', py, '--known', '101,201,205',
      '--areas', 'Web App\\Team A', '--people', 'dev.one@example.com'], testEnv());
    assert.equal(code, 0, text);
    assert.match(text, /^Work items: 3 match, 0 differ, 0 only in helper, 0 only in connector$/m);
    assert.match(text, /^Gone work items: 2 match/m);
    assert.match(text, /^PRs: 5 match/m);
    assert.match(text, /^Dataset items: 4 match/m);
    assert.match(text, /^Dataset events: [1-9]\d* match, 0 differ/m); // real clock here, so the count depends on today
    assert.match(text, /^Result: everything matches\.$/m);
    // Counts only: no titles, names, URLs, project names or secrets.
    for (const bad of ['Synthetic', 'Engineer A', 'Dev One', '127.0.0.1', 'Web App', PAT]) assert.ok(!text.includes(bad), `printed ${bad}`);
    assert.deepEqual(listAll(dir), before, 'compare wrote a file');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('compareLists counts differences by field name', () => {
  const r = compareLists([{ id: 1, a: 1 }, { id: 2, a: 1 }, { id: 3 }], [{ id: 1, a: 1 }, { id: 2, a: 2 }, { id: 4 }], x => x.id);
  assert.deepEqual(r, { match: 1, differ: 1, onlyHelper: 1, onlyConnector: 1, fields: { a: 1 } });
});

test('--import prints settings, and --write saves them without turning the connector on', async () => {
  const dir = tmpdir();
  const helperCfg = path.join(dir, 'ado-helper.json');
  const engCfg = path.join(dir, 'config.json');
  fs.writeFileSync(helperCfg, JSON.stringify({ base_url: 'https://ado.example.com/tfs/Main', pat_env: 'ADO_PAT' }));
  fs.writeFileSync(engCfg, JSON.stringify({ default: 'main', connections: { main: { serverUrl: 'https://ado.example.com/tfs', collection: 'Main' } } }));
  const env = { ...testEnv(), WORKSHOP_HOME: path.join(dir, 'home') };
  const dry = await run(['--import', '--helper-config', helperCfg, '--eng-agents-config', engCfg], env);
  assert.equal(dry.code, 0, dry.text);
  assert.match(dry.text, /Nothing was saved/);
  assert.ok(!fs.existsSync(path.join(dir, 'home')));
  const wet = await run(['--import', '--helper-config', helperCfg, '--eng-agents-config', engCfg, '--write'], env);
  assert.equal(wet.code, 0, wet.text);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'home', 'config.json'), 'utf8'));
  assert.equal(saved.configVersion, 1);
  assert.equal(saved.connectors.ado.enabled, false);
  assert.deepEqual(saved.connectors.ado.config.connections, [{ name: 'main', serverUrl: 'https://ado.example.com/tfs', collection: 'Main', patEnv: 'ADO_PAT' }]);
  // A second run merges with what is there instead of adding duplicates.
  await run(['--import', '--helper-config', helperCfg, '--eng-agents-config', engCfg, '--write'], env);
  const again = JSON.parse(fs.readFileSync(path.join(dir, 'home', 'config.json'), 'utf8'));
  assert.equal(again.connectors.ado.config.connections.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
