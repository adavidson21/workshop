// js/suite.js: the whole suite's numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { affectedCases, caseHash, caseHashes, caseState, checkSettings, commandRows, coverage, experimentRow, failureGroups, filesToInspect, latestByCase, modelMatrix, readSettings, settingsEnvelope } from '../js/suite.js';

const subtle = webcrypto.subtle;
const commands = [
  { command: 'spec', agent: 'planner', tokens: 4000, readTokens: 900, hash: '0123456789ab', files: ['core/commands/spec.md'] },
  { command: 'tsd', agent: 'writer', tokens: 4700, readTokens: 4800, hash: 'aaaaaaaaaaaa', files: [] },
  { command: 'status', agent: 'planner', tokens: 3000, readTokens: 0, hash: 'bbbbbbbbbbbb', files: [] }
];
const cases = [
  { name: 'spec-basic', commands: ['spec'], kind: 'behavior', lift: false, needs: [] },
  { name: 'tsd-draft', commands: ['tsd'], kind: 'writing', lift: false, needs: [] },
  { name: 'feature-outcome', commands: ['spec', 'do-task'], kind: 'outcome', lift: true, needs: ['dotnet'] }
];

async function setup() {
  const hashes = await caseHashes(cases, commands, subtle);
  const results = [
    { file: 'exp.json', date: '2026-11-16T10:00:00', experiment: 'trim-spec-1-ab12', compareTo: 'new.json', cases: [{ case: 'spec-basic', arm: 'tandem', rate: 100, passes: 2, total: 2, passAll: true, meanTokens: 3000 }] },
    { file: 'new.json', date: '2026-11-15T10:00:00', models: ['p/one'], cases: [
      { case: 'spec-basic', arm: 'tandem', model: 'p/one', rate: 50, passes: 1, total: 2, passAll: false, meanTokens: 4000, filesHash: hashes.get('spec-basic') },
      { case: 'tsd-draft', arm: 'tandem', model: 'p/one', rate: 100, passes: 2, total: 2, passAll: true, meanTokens: 9000, filesHash: 'oldoldoldold' },
      { case: 'feature-outcome', arm: 'baseline', model: 'p/one', rate: 0, passes: 0, total: 2 }
    ] },
    { file: 'old.json', date: '2026-11-10T10:00:00', cases: [{ case: 'spec-basic', arm: 'tandem', rate: 100, passes: 2, total: 2, passAll: true }] }
  ];
  return { hashes, results };
}

test('caseHash matches eng-agents: sha256 of the command hashes joined by commas, 12 hex', async () => {
  const h = await caseHash(['a', 'b'], new Map([['a', { hash: '0123456789ab' }], ['b', { hash: 'ba9876543210' }]]), subtle);
  assert.equal(h, '1ea1fcb22466', 'same as PowerShell Get-CaseFilesHash');
  assert.equal(await caseHash(['nope'], new Map(), subtle), null);
});

test('latestByCase skips experiments and other arms; caseState finds stale, failing and never-run', async () => {
  const { hashes, results } = await setup();
  const latest = latestByCase(results);
  assert.equal(latest.get('spec-basic').file, 'new.json', 'the experiment is not the latest');
  assert.equal(latest.has('feature-outcome'), false, 'baseline rows do not count');
  assert.equal(caseState('spec-basic', latest, hashes), 'failing');
  assert.equal(caseState('tsd-draft', latest, hashes), 'stale');
  assert.equal(caseState('feature-outcome', latest, hashes), 'never-run');
  assert.deepEqual(affectedCases(cases, results, hashes), ['tsd-draft', 'feature-outcome']);
});

test('commandRows: one row per command, what needs you first; coverage counts', async () => {
  const { hashes, results } = await setup();
  const rows = commandRows({ commands, cases, results, hashes });
  assert.deepEqual(rows.map((r) => [r.command, r.status]), [['spec', 'failing'], ['tsd', 'stale'], ['status', 'no-cases']]);
  assert.equal(rows[0].cases.length, 2);
  assert.equal(rows[0].rate, 50);
  assert.equal(rows[0].passAll, false);
  assert.deepEqual(coverage(rows, { agents: [{ agent: 'planner', rows: 3 }, { agent: 'chat', rows: 0 }] }), { commands: 3, covered: 2, agents: 2, guarded: 1 });
});

test('failureGroups and filesToInspect', async () => {
  const { results } = await setup();
  assert.deepEqual(filesToInspect(results), ['new.json']);
  const details = [{ file: 'new.json', cases: [
    { case: 'spec-basic', arm: 'tandem', runs: [{ failed: [{ check: 'plan cites files: x.cs' }] }, { failed: [{ check: 'plan cites files: y.cs' }, { check: 'ACs testable' }] }] },
    { case: 'tsd-draft', arm: 'tandem', runs: [{ failed: [], timedOut: true }] },
    { case: 'feature-outcome', arm: 'baseline', runs: [{ failed: [{ check: 'ignored' }] }] }
  ] }];
  const g = failureGroups(details);
  assert.deepEqual(g.map((x) => [x.check, x.runs, x.cases.length]), [['plan cites files', 2, 1], ['ACs testable', 1, 1], ['timed out', 1, 1]]);
  assert.deepEqual(g[0].cases, [{ name: 'spec-basic', file: 'new.json' }]);
});

test('experimentRow compares the experiment run with what it was compared to', async () => {
  const { results } = await setup();
  const row = experimentRow({ id: 'trim-spec-1-ab12', kind: 'trim', command: 'spec', case: null, results: ['exp.json'], status: 'proposed' }, results);
  assert.equal(row.verdict, 'better');
  assert.deepEqual([row.before.rate, row.after.rate, row.before.tokens, row.after.tokens], [50, 100, 4000, 3000]);
  assert.equal(experimentRow({ id: 'x', results: [] }, results).verdict, 'untested');
});

test('modelMatrix names the cheapest model that passes every run', () => {
  const m = modelMatrix([{ file: 'm.json', cases: [
    { case: 'spec-basic', arm: 'tandem', model: 'p/big', rate: 100, passAll: true, meanTokens: 9000 },
    { case: 'spec-basic', arm: 'tandem', model: 'p/small', rate: 100, passAll: true, meanTokens: 3000 },
    { case: 'tsd-draft', arm: 'tandem', model: 'p/small', rate: 50, passAll: false, meanTokens: 2000 },
    { case: 'tsd-draft', arm: 'tandem', model: 'p/big', rate: 100, passAll: true, meanTokens: 8000 }
  ] }]);
  assert.deepEqual(m.models, ['p/big', 'p/small']);
  assert.equal(m.cheapest.get('spec-basic'), 'p/small');
  assert.equal(m.cheapest.get('tsd-draft'), 'p/big');
});

test('settings: defaults, checks and the envelope', () => {
  assert.deepEqual(readSettings(null), { testModel: '', judgeModel: '', suggestModel: '', maxRuns: 30 });
  const env = settingsEnvelope(null, { testModel: 'p/free', judgeModel: '', suggestModel: 'p/strong', maxRuns: 40 }, 123);
  assert.equal(env.schema, 'bench.settings');
  assert.deepEqual(env.items, [{ id: 'prefs', testModel: 'p/free', judgeModel: '', suggestModel: 'p/strong', maxRuns: 40, updatedAt: 123 }]);
  assert.equal(readSettings(env).suggestModel, 'p/strong');
  assert.equal(readSettings({ items: [{ id: 'prefs', testModel: 'bad model', maxRuns: 9999 }] }).testModel, '');
  assert.equal(checkSettings({ testModel: 'nope', maxRuns: 30 }).ok, false);
  assert.equal(checkSettings({ testModel: '', maxRuns: 0 }).ok, false);
  assert.equal(checkSettings({ testModel: 'p/m', judgeModel: '', suggestModel: '', maxRuns: '30' }).ok, true);
});
