// tandem-health.js: Builds' Health > Tandem, pure HTML builders for the opencode connector's tandem.health answer
// (Workshop docs/tandem-health.md). The fixture is that answer for docs/examples/work, with no install record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAMP_MIN, STAMP_RATE, learningHtml, pipelineHtml, promptsHtml, setupHtml, tandemHealthHtml } from '../js/tandem-health.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = () => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'tandem-health.json'), 'utf8'));

test('a note, loading, an error, and a version it does not know', () => {
  assert.match(tandemHealthHtml({ note: 'Connect <opencode>' }), /Connect &lt;opencode&gt;/);
  assert.match(tandemHealthHtml({ data: null }), /Reading \.work/);
  assert.match(tandemHealthHtml({ data: null, error: 'boom' }), /class="warn">boom/);
  assert.match(tandemHealthHtml({ data: { version: 2 } }), /reads Tandem health version 1/);
});

test('the four parts, the range buttons and Refresh', () => {
  const html = tandemHealthHtml({ data: fixture(), range: '30' });
  for (const h of ['Pipeline', 'Learning loop', 'Prompts', 'Setup']) assert.match(html, new RegExp(`class="tsh">${h}<`));
  assert.match(html, /data-act="tandem-range" data-id="30" aria-pressed="true"/);
  assert.match(html, /data-act="tandem-range" data-id="" aria-pressed="false"/);
  assert.match(html, /data-act="tandem-refresh"/);
  assert.match(html, /nothing is stored or sent anywhere/);
});

test('pipeline: tiles, gates, and recent items that open their run', () => {
  const html = pipelineHtml(fixture().pipeline);
  assert.match(html, /3 days/);
  assert.match(html, /40%/);
  assert.match(html, /<th scope="row">spec\.md<\/th>/);
  assert.match(html, /data-act="open-run" data-id="41610-rate-limit-headers"/);
  assert.doesNotMatch(html, /rubber stamp\?/, 'one approval per gate is too few to call a stamp');
  const p = fixture().pipeline;
  p.gates.plan = { approvals: STAMP_MIN, unchanged: STAMP_MIN, edited: 0, noHash: 0, unchangedRate: 100 };
  assert.match(pipelineHtml(p), /rubber stamp\?/);
  p.gates.plan.unchangedRate = STAMP_RATE - 1;
  assert.doesNotMatch(pipelineHtml(p), /rubber stamp\?/);
  assert.match(pipelineHtml({ summary: { items: 0 }, gates: {}, items: [] }), /No work items yet/);
});

test('learning loop: categories, nothing repeats yet, then a pattern that does', () => {
  const { pipeline, findings } = fixture();
  let html = learningHtml(pipeline, findings);
  assert.match(html, /consistency/);
  assert.match(html, /Nothing repeats yet/);
  findings.patterns.unshift({ repo: 'api', category: 'correctness', itemCount: 2, items: ['1-a', '2-b'], findings: 3, blockers: 1, repeats: true, examples: ['1-a: null <check>'] });
  html = learningHtml(pipeline, findings);
  assert.match(html, /<b>api<\/b>, correctness: 2 items, 3 findings, 1 Blocker/);
  assert.match(html, /null &lt;check&gt;/);
  assert.match(html, /\/retro --since/);
});

test('prompts: no install record, no results, then drops marked against the previous run', () => {
  assert.match(promptsHtml(null), /install record was not found/);
  assert.match(promptsHtml({ latest: null, previous: null }), /Invoke-Evals\.ps1/);
  const run = (rate, date) => ({ tandem: '2.26.0', model: 'm', runsPerCase: 3, date, cases: [{ case: 'spec-basic', passes: 2, total: 3, rate }, { case: 'do-task', skipped: 'needs dotnet' }] });
  const html = promptsHtml({ latest: run(67, '2026-11-14T10:00:00'), previous: run(100, '2026-11-01T10:00:00') });
  assert.match(html, /1 case dropped/);
  assert.match(html, /class="num warn">-33</);
  assert.match(html, /Skipped: needs dotnet/);
  assert.doesNotMatch(promptsHtml({ latest: run(100, 'x'), previous: null }), /dropped/);
});

test('setup: version, missing and unfinished repo guides', () => {
  const html = setupHtml({ install: { version: '2.26.0', commit: 'abcdef1234', installed: '2026-11-14T10:00:00' }, workspace: 'C:/src/work', repoGuides: { total: 3, missing: ['docs'], todo: ['web'] } });
  assert.match(html, /2\.26\.0 <span class="soft">\(abcdef1\)<\/span>/);
  assert.match(html, /2 of 3 repos/);
  assert.match(html, /No repo guide: <code>docs<\/code>/);
  assert.match(html, /TODO\(you\): <code>web<\/code>/);
  assert.match(setupHtml({ install: null, workspace: null, repoGuides: { total: 0, missing: [], todo: [] } }), /Not installed from a repo/);
});
