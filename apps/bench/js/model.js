/* Bench's numbers: pure functions over the opencode connector's evals.* results (docs/bench.md). No DOM, no SDK.

   A results file has cases, each in an arm: `tandem` (Tandem's commands) or `baseline` (one plain prompt, Tandem
   left out, same model). The lift is Tandem's pass rate minus the baseline's, in points. pass@1 here is the share of
   runs that passed; "every run" (pass^k) is whether all k runs of a case passed. */

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** The newest result that ran both arms, or null. Results come newest first. */
export function latestWithLift(results) {
  return (results || []).find((r) => !r.unsupported && r.lift && r.lift.length) || null;
}

/** Runs and passes over the cases that ran in both arms, per arm. */
export function armTotals(result) {
  const both = new Set(((result && result.lift) || []).map((l) => l.case));
  const out = { tandem: { passes: 0, total: 0, all: 0, cases: 0 }, baseline: { passes: 0, total: 0, all: 0, cases: 0 } };
  for (const c of (result && result.cases) || []) {
    if (!both.has(c.case) || c.skipped || !out[c.arm]) continue;
    const o = out[c.arm];
    o.passes += c.passes || 0;
    o.total += c.total || 0;
    o.cases += 1;
    if (c.passAll) o.all += 1;
  }
  for (const a of Object.values(out)) a.rate = a.total ? Math.round((100 * a.passes) / a.total) : null;
  return out;
}

/** What the result says, in one line and a verdict word: helps, edge, same, worse, or none. */
export function headline(result) {
  if (!result || !result.lift || !result.lift.length) return { verdict: 'none', points: null, text: 'No run with both arms yet.' };
  const t = armTotals(result);
  const points = t.tandem.rate == null || t.baseline.rate == null ? null : t.tandem.rate - t.baseline.rate;
  const verdict = points == null ? 'none' : points >= 20 ? 'helps' : points > 0 ? 'edge' : points === 0 ? 'same' : 'worse';
  const words = {
    helps: 'Tandem helps',
    edge: 'Tandem has a small edge',
    same: 'No difference',
    worse: 'The plain prompt did better',
    none: 'Not enough to say'
  }[verdict];
  const text = `${words}: Tandem passed ${t.tandem.passes} of ${t.tandem.total} runs, the plain prompt ${t.baseline.passes} of ${t.baseline.total}`;
  return { verdict, points, text, totals: t };
}

/** Why a result should not be trusted yet, as short notes. */
export function caveats(result) {
  const out = [];
  if (!result) return out;
  if (result.runsPerCase != null && result.runsPerCase < 3) out.push(`Only ${result.runsPerCase} run${result.runsPerCase === 1 ? '' : 's'} per case. Run 3 or more before trusting a lift.`);
  const t = armTotals(result);
  if (t.tandem.total && t.tandem.total < 6) out.push('Few runs in total, so one lucky or unlucky run moves the lift a lot.');
  if (result.autoApprove === false) out.push('Run without -AutoApprove: a run that hit an ask rule waited and timed out, which counts as a fail.');
  if ((result.cases || []).some((c) => c.skipped)) out.push('Some cases were skipped (see Cases).');
  return out;
}

/** Rate change per case and arm between two results (older first, newer second). */
export function compare(older, newer) {
  const key = (c) => `${c.case}|${c.arm}`;
  const before = new Map(((older && older.cases) || []).filter((c) => c.rate != null).map((c) => [key(c), c]));
  const rows = [];
  for (const c of (newer && newer.cases) || []) {
    const b = before.get(key(c));
    rows.push({ case: c.case, arm: c.arm, before: b ? b.rate : null, after: c.skipped ? null : c.rate, change: b && c.rate != null ? c.rate - b.rate : null, skipped: c.skipped || null });
  }
  return rows.sort((a, b) => (a.case === b.case ? (a.arm < b.arm ? 1 : -1) : a.case < b.case ? -1 : 1));
}

/** Tandem-arm pass rate over every case of a result (for History), or null. */
export function tandemRate(result) {
  const cs = ((result && result.cases) || []).filter((c) => c.arm === 'tandem' && !c.skipped && c.total);
  const total = sum(cs.map((c) => c.total));
  return total ? Math.round((100 * sum(cs.map((c) => c.passes || 0))) / total) : null;
}

/** "4m 50s", "38s", or an empty string. */
export function fmtSeconds(s) {
  if (s == null || !Number.isFinite(s)) return '';
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
}

/** "Nov 14" style day from an ISO date-time, or the raw text. */
export function fmtDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso || '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** "+34", "-10", "0", or "n/a". */
export function fmtPoints(p) {
  if (p == null) return 'n/a';
  return p > 0 ? `+${p}` : String(p);
}

/** The run form's defaults and checks, before anything goes to the connector. Returns {ok, error, args}. */
export function runRequest(form, cases) {
  const picked = (form.cases || []).filter((n) => cases.some((c) => c.name === n));
  if (!picked.length) return { ok: false, error: 'Pick at least one case.' };
  const arm = ['tandem', 'baseline', 'both'].includes(form.arm) ? form.arm : 'tandem';
  if (arm !== 'tandem' && !picked.some((n) => (cases.find((c) => c.name === n) || {}).lift)) return { ok: false, error: 'None of the picked cases has a baseline prompt. Pick feature-outcome, or run the Tandem arm only.' };
  const runs = Number(form.runs);
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) return { ok: false, error: 'Runs per case must be 1 to 10.' };
  const model = String(form.model || '').trim();
  if (model && !/^[A-Za-z0-9._-]{1,60}\/[A-Za-z0-9._:/-]{1,120}$/.test(model)) return { ok: false, error: 'Model must look like provider/model, or be empty for your opencode default.' };
  const args = { cases: picked, arm, runs, autoApprove: !!form.autoApprove };
  if (model) args.model = model;
  return { ok: true, args };
}

/** Rough run count for the confirm text: cases times runs times arms (baseline only where a case has one). */
export function runCount(args, cases) {
  let n = 0;
  for (const name of args.cases) {
    const c = cases.find((x) => x.name === name) || {};
    if (args.arm !== 'baseline') n += args.runs;
    if (args.arm !== 'tandem' && c.lift) n += args.runs;
  }
  return n;
}

/** "12.4k", "850", "1.2M", or an empty string. Token counts read better rounded. */
export function fmtTokens(n) {
  if (n == null || !Number.isFinite(n)) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(n));
}

/** "$0.04", "free" for 0, or an empty string. */
export function fmtCost(c) {
  if (c == null || !Number.isFinite(c)) return '';
  if (c === 0) return 'free';
  return c < 0.01 ? '<$0.01' : `$${c.toFixed(2)}`;
}

/** Tokens per passing run for each arm over the lift cases, when the file has usage (version 3). */
export function efficiency(result) {
  const both = new Set(((result && result.lift) || []).map((l) => l.case));
  const out = {};
  for (const arm of ['tandem', 'baseline']) {
    const cs = ((result && result.cases) || []).filter((c) => c.arm === arm && both.has(c.case) && c.usageKnown && c.meanTokens != null);
    if (!cs.length) { out[arm] = null; continue; }
    const tokens = sum(cs.map((c) => c.meanTokens * (c.total || 0)));
    const passes = sum(cs.map((c) => c.passes || 0));
    out[arm] = { tokensPerRun: Math.round(tokens / Math.max(1, sum(cs.map((c) => c.total || 0)))), tokensPerPass: passes ? Math.round(tokens / passes) : null };
  }
  return out;
}
