// js/suite-view.js: Overview, a command, Improve and Run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandHtml, improveHtml, overviewHtml, runHtml } from '../js/suite-view.js';
import { readSettings } from '../js/suite.js';

const base = () => ({
  commands: [{ command: 'spec', agent: 'planner', tokens: 4000, readTokens: 900, hash: 'h1', files: ['core/commands/spec.md'] }, { command: 'status', agent: 'planner', tokens: 3000, readTokens: 0, hash: 'h2', files: [] }],
  cases: [{ name: 'spec-basic', commands: ['spec'], kind: 'behavior', lift: false, needs: [], description: 'spec <b>' }],
  results: [{ file: 'r.json', date: '2026-11-15T10:00:00', cases: [{ case: 'spec-basic', arm: 'tandem', rate: 50, passes: 1, total: 2, passAll: false, meanTokens: 4100 }] }],
  hashes: new Map(), guards: { agents: [{ agent: 'planner', rows: 3 }] }, experiments: [], details: [],
  settings: readSettings(null), source: '/me/eng-agents', affected: ['spec-basic'],
  form: { preset: 'affected', cases: [], arm: 'tandem', runs: 1, models: '', judge: false, autoApprove: true }
});

test('Overview: coverage, what needs you, one row per command with its state in words', () => {
  const h = overviewHtml(base());
  assert.match(h, /1<span class="soft">\/2<\/span><\/span><span class="soft">commands with cases/);
  assert.match(h, /1<span class="soft">\/1<\/span><\/span><span class="soft">agents guarded/);
  assert.match(h, /data-command="spec"[\s\S]*Failing/);
  assert.match(h, /data-command="status"[\s\S]*No cases/);
  assert.ok(h.indexOf('data-command="spec"') < h.indexOf('data-command="status"'), 'failing first');
  const none = overviewHtml({ ...base(), commands: [] });
  assert.match(none, /No <code>evals\/commands.json<\/code>/);
});

test('A command: its cases, files, one primary action', () => {
  const h = commandHtml({ ...base(), commandName: 'spec' });
  assert.match(h, /<code>\/spec<\/code>/);
  assert.match(h, /spec-basic/);
  assert.match(h, /core\/commands\/spec.md/);
  assert.equal((h.match(/btn primary/g) || []).length, 1);
  assert.match(commandHtml({ ...base(), commandName: 'status' }), /No cases use this command yet/);
  assert.match(commandHtml({ ...base(), commandName: 'gone' }), /No command/);
});

test('Improve: failure groups with Suggest a fix (off without a suggestion model), experiments with Test, Keep, Drop', () => {
  const st = { ...base(), details: [{ file: 'r.json', cases: [{ case: 'spec-basic', arm: 'tandem', runs: [{ failed: [{ check: 'ACs testable' }] }] }] }],
    experiments: [{ id: 'trim-spec-1-ab12', kind: 'trim', command: 'spec', reason: 'Remove <x>', status: 'proposed', results: [] }] };
  const off = improveHtml(st);
  assert.match(off, /ACs testable/);
  assert.match(off, /data-act="suggest"[^>]*disabled/);
  assert.match(off, /Pick a suggestion model/);
  assert.match(off, /Remove &lt;x&gt;/);
  assert.match(off, /Not tested yet/);
  assert.match(off, /data-act="test-exp"[\s\S]*data-act="keep-exp"[\s\S]*data-act="drop-exp"/);
  assert.equal((off.match(/btn primary/g) || []).length, 0, 'no primary buttons in a list');
  const on = improveHtml({ ...st, settings: { ...st.settings, suggestModel: 'p/strong' } });
  assert.equal(/data-act="suggest"[^>]*disabled/.test(on), false);
});

test('Run: presets, affected count, judge needs a model, one primary per form, settings form', () => {
  const h = runHtml(base());
  assert.match(h, /data-preset="affected" aria-pressed="true"/);
  assert.match(h, /Right now: 1 case\./);
  assert.match(h, /name="judge" disabled/);
  assert.equal((h.match(/btn primary/g) || []).length, 1);
  assert.match(h, /id="settingsForm"/);
  assert.equal(h.includes('name="case"'), false, 'no case list for Affected');
  const custom = runHtml({ ...base(), form: { ...base().form, preset: 'custom', cases: ['spec-basic'] } });
  assert.match(custom, /value="spec-basic" checked/);
  assert.match(custom, /spec &lt;b&gt;/);
  assert.match(custom, /name="arm"/);
});
