// js/model.js: Bench's numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armTotals, caveats, compare, fmtDay, fmtPoints, fmtSeconds, headline, latestWithLift, runCount, runRequest, tandemRate } from '../js/model.js';

const result = (t, b, extra = {}) => ({
  file: 'r.json', date: '2026-11-14T10:00:00', tandem: '3.1.0', model: 'opencode/free', runsPerCase: 3, autoApprove: true, arms: ['tandem', 'baseline'],
  cases: [
    { case: 'feature-outcome', arm: 'tandem', passes: t, total: 3, rate: Math.round((100 * t) / 3), passAll: t === 3, meanSeconds: 300 },
    { case: 'feature-outcome', arm: 'baseline', passes: b, total: 3, rate: Math.round((100 * b) / 3), passAll: b === 3, meanSeconds: 90 },
    { case: 'spec-basic', arm: 'tandem', passes: 1, total: 3, rate: 33, passAll: false }
  ],
  lift: [{ case: 'feature-outcome', tandem: Math.round((100 * t) / 3), baseline: Math.round((100 * b) / 3), lift: Math.round((100 * t) / 3) - Math.round((100 * b) / 3), tandemAll: t === 3, baselineAll: b === 3 }],
  ...extra
});

test('latestWithLift skips results without a lift and unsupported files', () => {
  const r = result(3, 1);
  assert.equal(latestWithLift([{ unsupported: true, lift: [{}] }, { lift: [] }, r]), r);
  assert.equal(latestWithLift([]), null);
  assert.equal(latestWithLift(undefined), null);
});

test('armTotals and headline count only cases that ran in both arms', () => {
  const t = armTotals(result(3, 1));
  assert.deepEqual([t.tandem.passes, t.tandem.total, t.tandem.rate, t.tandem.all], [3, 3, 100, 1]);
  assert.deepEqual([t.baseline.passes, t.baseline.total, t.baseline.rate], [1, 3, 33]);
  const h = headline(result(3, 1));
  assert.equal(h.verdict, 'helps');
  assert.equal(h.points, 67);
  assert.equal(h.text, 'Tandem helps: Tandem passed 3 of 3 runs, the plain prompt 1 of 3');
  assert.equal(headline(result(2, 2)).verdict, 'same');
  assert.equal(headline(result(1, 3)).verdict, 'worse');
  assert.equal(headline(result(2, 1, { runsPerCase: 3 })).verdict, 'helps', '+34 points is a real lift');
  assert.equal(headline(null).verdict, 'none');
});

test('caveats warn about few runs, no auto-approve and skipped cases', () => {
  assert.deepEqual(caveats(result(3, 1)), ['Few runs in total, so one lucky or unlucky run moves the lift a lot.']);
  const few = caveats(result(1, 0, { runsPerCase: 1, autoApprove: false }));
  assert.ok(few.some((n) => n.startsWith('Only 1 run per case')));
  assert.ok(few.some((n) => n.includes('-AutoApprove')));
  const r = result(3, 1); r.cases.push({ case: 'do-task', arm: 'tandem', skipped: 'needs dotnet' });
  assert.ok(caveats(r).some((n) => n.includes('skipped')));
});

test('compare lines up cases by case and arm; tandemRate sums the tandem arm', () => {
  const rows = compare(result(1, 1), result(3, 0));
  assert.deepEqual(rows.map((r) => [r.case, r.arm, r.before, r.after, r.change]), [
    ['feature-outcome', 'tandem', 33, 100, 67],
    ['feature-outcome', 'baseline', 33, 0, -33],
    ['spec-basic', 'tandem', 33, 33, 0]
  ]);
  assert.equal(tandemRate(result(3, 0)), 67, '3 of 3 plus 1 of 3');
  assert.equal(tandemRate({ cases: [] }), null);
});

test('formatting', () => {
  assert.equal(fmtSeconds(290), '4m 50s');
  assert.equal(fmtSeconds(38), '38s');
  assert.equal(fmtSeconds(null), '');
  assert.equal(fmtDay('2026-11-14T10:00:00'), 'Nov 14, 2026');
  assert.equal(fmtPoints(34), '+34');
  assert.equal(fmtPoints(-5), '-5');
  assert.equal(fmtPoints(null), 'n/a');
});

test('runRequest checks the form before it goes to the connector; runCount counts arms', () => {
  const cases = [{ name: 'feature-outcome', lift: true }, { name: 'spec-basic', lift: false }];
  const ok = runRequest({ cases: ['feature-outcome', 'gone'], arm: 'both', runs: '3', model: ' opencode/free ', autoApprove: true }, cases);
  assert.deepEqual(ok, { ok: true, args: { cases: ['feature-outcome'], arm: 'both', runs: 3, autoApprove: true, model: 'opencode/free' } });
  assert.equal(runCount(ok.args, cases), 6);
  assert.equal(runCount({ cases: ['feature-outcome', 'spec-basic'], arm: 'both', runs: 2 }, cases), 6, 'spec-basic has no baseline');
  assert.equal(runRequest({ cases: [] }, cases).ok, false);
  assert.match(runRequest({ cases: ['spec-basic'], arm: 'both', runs: 3 }, cases).error, /baseline prompt/);
  assert.match(runRequest({ cases: ['spec-basic'], arm: 'tandem', runs: 11 }, cases).error, /1 to 10/);
  assert.match(runRequest({ cases: ['spec-basic'], arm: 'tandem', runs: 3, model: 'nope' }, cases).error, /provider\/model/);
});

test('version 3 usage: tokens and cost formatting, tokens per passing run per arm', async () => {
  const { efficiency, fmtCost, fmtTokens } = await import('../js/model.js');
  assert.equal(fmtTokens(850), '850');
  assert.equal(fmtTokens(12400), '12.4k');
  assert.equal(fmtTokens(2000000), '2M');
  assert.equal(fmtTokens(null), '');
  assert.equal(fmtCost(0), 'free');
  assert.equal(fmtCost(0.004), '<$0.01');
  assert.equal(fmtCost(0.0412), '$0.04');
  const r = result(3, 1);
  r.cases[0] = { ...r.cases[0], usageKnown: true, meanTokens: 40000 };
  r.cases[1] = { ...r.cases[1], usageKnown: true, meanTokens: 9000 };
  assert.deepEqual(efficiency(r), { tandem: { tokensPerRun: 40000, tokensPerPass: 40000 }, baseline: { tokensPerRun: 9000, tokensPerPass: 27000 } });
  assert.deepEqual(efficiency(result(3, 1)), { tandem: null, baseline: null }, 'no usage in older files');
});
