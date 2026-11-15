// js/view.js: what each tab shows, and that results-file text is escaped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyHtml, historyHtml, liftCardHtml, liftHtml, resultHtml, tabsHtml } from '../js/view.js';

const lifted = {
  file: '3.1.0-1.json', date: '2026-11-14T10:00:00', tandem: '3.1.0', model: 'opencode/<b>free</b>', runsPerCase: 3, autoApprove: true, arms: ['tandem', 'baseline'],
  cases: [
    { case: 'feature-outcome', arm: 'tandem', passes: 3, total: 3, rate: 100, passAll: true, meanSeconds: 300 },
    { case: 'feature-outcome', arm: 'baseline', passes: 1, total: 3, rate: 33, passAll: false, meanSeconds: 90 }
  ],
  lift: [{ case: 'feature-outcome', tandem: 100, baseline: 33, lift: 67, tandemAll: true, baselineAll: false }]
};
const tandemOnly = { file: '3.0.0-1.json', date: '2026-11-10T10:00:00', tandem: '3.0.0', model: 'm', runsPerCase: 3, arms: ['tandem'], cases: [{ case: 'spec-basic', arm: 'tandem', passes: 2, total: 3, rate: 67 }], lift: [] };

test('tabs mark the current one', () => {
  assert.match(tabsHtml('history'), /data-tab="history" aria-current="page"/);
  assert.equal((tabsHtml('overview').match(/aria-current/g) || []).length, 1);
  assert.match(tabsHtml('overview'), /Overview.*Improve.*History.*Run/s);
});

test('Lift shows the points, the verdict in words, both bars and the per-case table, and escapes the model', () => {
  const h = liftHtml({ results: [lifted, tandemOnly] });
  assert.match(h, /\+67<\/span><span class="unit">points/);
  assert.match(h, /Tandem helps: Tandem passed 3 of 3 runs, the plain prompt 1 of 3\./);
  assert.match(h, /aria-label="Tandem 100%, plain prompt 33%"/);
  assert.match(h, /opencode\/&lt;b&gt;free&lt;\/b&gt;/);
  assert.equal(h.includes('<b>free</b>'), false);
  assert.match(h, /data-act="open-result" data-file="3.1.0-1.json"/);
});

test('Lift without a two-arm run says how to get one, with one action', () => {
  const h = liftHtml({ results: [tandemOnly] });
  assert.match(h, /No lift yet/);
  assert.match(h, /ran the Tandem arm only/);
  assert.equal((h.match(/btn primary/g) || []).length, 1);
});

test('History lists runs and compares two once two are ticked', () => {
  const one = historyHtml({ results: [lifted, tandemOnly], compare: [] });
  assert.match(one, /Tick two to compare them/);
  const two = historyHtml({ results: [lifted, tandemOnly], compare: ['3.1.0-1.json', '3.0.0-1.json'] });
  assert.match(two, /Nov 10, 2026 → Nov 14, 2026/);
  assert.match(two, /Different models: compare with care/);
});

test('A result shows every run with pass or fail in words, steps and failed checks', () => {
  const detail = {
    ...lifted,
    cases: [{ case: 'feature-outcome', arm: 'baseline', passes: 0, total: 1, rate: 0, passAll: false, runs: [
      { run: 1, pass: false, seconds: 88, timedOut: false, log: '/tmp/x.log', failed: [{ check: 'threshold and rate live in PricingOptions', detail: '<script>' }], steps: [{ step: 'plain prompt', ok: true, seconds: 88 }] }
    ] }]
  };
  const h = resultHtml({ detail });
  assert.match(h, /Fail<\/span>/);
  assert.match(h, /Plain prompt/);
  assert.match(h, /threshold and rate live in PricingOptions/);
  assert.match(h, /&lt;script&gt;/);
  assert.match(h, /data-act="copy" data-text="\/tmp\/x.log"/);
  assert.match(resultHtml({ detail: { unsupported: true, version: 9 } }), /version 9/);
});

test('the lift card is the hero only, with a link to the per-case page', () => {
  const card = liftCardHtml({ results: [lifted] });
  assert.match(card, /\+67<\/span>/);
  assert.match(card, /data-act="open-lift"/);
  assert.equal(card.includes('By case</h2>'), false);
  assert.equal(liftCardHtml({ results: [tandemOnly] }), '');
});

test('bodyHtml shows setup notes, loading and errors first', () => {
  assert.match(bodyHtml({ note: { title: 'Turn on the opencode connector', body: 'x' } }), /Turn on the opencode connector/);
  assert.match(bodyHtml({ loading: true }), /Reading Tandem/);
  assert.match(bodyHtml({ error: '<oops>' }), /&lt;oops&gt;/);
});

test('version 3: Lift adds tokens per run and per passing run; a run shows tokens, questions and failed verifies', () => {
  const v3 = structuredClone(lifted);
  v3.cases[0] = { ...v3.cases[0], usageKnown: true, meanTokens: 40000 };
  v3.cases[1] = { ...v3.cases[1], usageKnown: true, meanTokens: 9000 };
  const h = liftHtml({ results: [v3] });
  assert.match(h, /Tokens per run<\/th>/);
  assert.match(h, /40k \/ 9k/);
  assert.match(h, /Tokens per passing run: Tandem 40k, plain prompt 27k\./);
  assert.equal(liftHtml({ results: [lifted] }).includes('Tokens per run'), false, 'older files show no token column');
  const detail = { ...lifted, cases: [{ case: 'feature-outcome', arm: 'tandem', passes: 1, total: 1, rate: 100, passAll: true, runs: [
    { run: 1, pass: true, seconds: 400, tokens: 41200, cost: 0, questions: 2, verifyFails: 1, failed: [], steps: [{ step: '/spec L1 auto', ok: true, seconds: 60, tokens: 8000 }, { step: 'approve spec.md', ok: true, seconds: 0, tokens: 0 }] }
  ] }] };
  const d = resultHtml({ detail });
  assert.match(d, /41.2k tokens/);
  assert.match(d, /2 questions asked/);
  assert.match(d, /1 failed verify/);
  assert.match(d, /1m 00s, 8k tokens/);
});
