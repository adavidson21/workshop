/* Bench 2's numbers for the whole suite: pure functions over the connector's evals.* answers (docs/bench.md).
   No DOM, no SDK. "Latest" always means the newest results file that ran a case in the tandem arm and was not an
   experiment, on any model unless a model is given. */

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
export const STATUS_ORDER = ['failing', 'stale', 'never-run', 'no-cases', 'ok'];
export const STATUS_WORDS = { failing: 'Failing', stale: 'Prompt changed', 'never-run': 'Not run yet', 'no-cases': 'No cases', ok: 'Passing' };

/** case name -> { entry, file, date } from the newest non-experiment results file with that case (tandem arm). */
export function latestByCase(results, model = null) {
  const out = new Map();
  for (const r of results || []) {
    if (r.unsupported || r.experiment) continue;
    for (const c of r.cases || []) {
      if (c.arm !== 'tandem' || c.skipped || c.rate == null) continue;
      if (model && c.model && c.model !== model) continue;
      if (!out.has(c.case)) out.set(c.case, { entry: c, file: r.file, date: r.date, model: c.model || r.models?.[0] || null });
    }
  }
  return out;
}

/** The files hash of a case, as eng-agents works it out: sha256 of its commands' hashes joined by commas, 12 hex. */
export async function caseHash(caseCommands, commandsByName, subtle = globalThis.crypto && globalThis.crypto.subtle) {
  const hs = caseCommands.map((n) => commandsByName.get(n)?.hash).filter(Boolean);
  if (!hs.length || !subtle) return null;
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(hs.join(',')));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

/** case name -> current files hash, for every case. */
export async function caseHashes(cases, commands, subtle) {
  const byName = new Map((commands || []).map((c) => [c.command, c]));
  const out = new Map();
  for (const c of cases || []) out.set(c.name, await caseHash(c.commands || [], byName, subtle));
  return out;
}

/** A case's state: never-run, stale (its prompts changed since its latest run), failing, or ok. */
export function caseState(name, latest, hashes) {
  const l = latest.get(name);
  if (!l) return 'never-run';
  const now = hashes && hashes.get(name);
  if (now && l.entry.filesHash && now !== l.entry.filesHash) return 'stale';
  if (l.entry.rate < 100 || l.entry.passAll === false) return 'failing';
  return 'ok';
}

/** One row per command: its cases, combined pass rate and reliability, tokens, prompt size, and a state. */
export function commandRows({ commands = [], cases = [], results = [], hashes = new Map() }) {
  const latest = latestByCase(results);
  const rows = commands.map((cmd) => {
    const its = cases.filter((c) => (c.commands || []).includes(cmd.command));
    const states = its.map((c) => caseState(c.name, latest, hashes));
    const ran = its.map((c) => latest.get(c.name)).filter(Boolean);
    const passes = sum(ran.map((l) => l.entry.passes || 0));
    const total = sum(ran.map((l) => l.entry.total || 0));
    const tok = ran.filter((l) => l.entry.meanTokens != null);
    const status = !its.length ? 'no-cases' : states.includes('failing') ? 'failing' : states.includes('stale') ? 'stale' : states.includes('never-run') ? 'never-run' : 'ok';
    return {
      command: cmd.command, agent: cmd.agent, tokens: cmd.tokens, readTokens: cmd.readTokens, files: cmd.files || [],
      cases: its.map((c, i) => ({ name: c.name, kind: c.kind, state: states[i], latest: latest.get(c.name) || null })),
      rate: total ? Math.round((100 * passes) / total) : null, passes, total,
      passAll: ran.length ? ran.every((l) => l.entry.passAll) : null,
      meanTokens: tok.length ? Math.round(sum(tok.map((l) => l.entry.meanTokens)) / tok.length) : null,
      status
    };
  });
  return rows.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (a.command < b.command ? -1 : 1));
}

/** Coverage: commands with at least one case, and agents with guard rows. */
export function coverage(rows, guards) {
  const covered = rows.filter((r) => r.cases.length).length;
  const agents = (guards && guards.agents) || [];
  return { commands: rows.length, covered, agents: agents.length, guarded: agents.filter((a) => a.rows > 0).length };
}

/** Cases that need a run after a prompt change (stale or never run): what -Affected would pick. */
export function affectedCases(cases, results, hashes) {
  const latest = latestByCase(results);
  return (cases || []).filter((c) => ['stale', 'never-run'].includes(caseState(c.name, latest, hashes))).map((c) => c.name);
}

/** Failed checks across result details (evals.result answers), grouped by check name, biggest first. */
export function failureGroups(details) {
  const groups = new Map();
  for (const d of details || []) {
    if (!d || d.unsupported) continue;
    for (const c of d.cases || []) {
      if (c.arm !== 'tandem') continue;
      for (const run of c.runs || []) {
        const names = run.failed.length ? run.failed.map((f) => f.check) : run.timedOut ? ['timed out'] : [];
        for (const raw of names) {
          const check = String(raw).replace(/:.*$/, '').trim() || 'failed';
          if (!groups.has(check)) groups.set(check, { check, runs: 0, cases: new Map() });
          const g = groups.get(check);
          g.runs += 1;
          if (!g.cases.has(c.case)) g.cases.set(c.case, d.file);
        }
      }
    }
  }
  return [...groups.values()]
    .map((g) => ({ check: g.check, runs: g.runs, cases: [...g.cases.entries()].map(([name, file]) => ({ name, file })) }))
    .sort((a, b) => b.runs - a.runs || (a.check < b.check ? -1 : 1));
}

/** The newest results files worth reading in detail for failure groups: each failing case's latest file (at most 4). */
export function filesToInspect(results) {
  const latest = latestByCase(results);
  const files = [];
  for (const l of latest.values()) if ((l.entry.rate < 100 || l.entry.passAll === false) && !files.includes(l.file)) files.push(l.file);
  return files.slice(0, 4);
}

/** An experiment against what it was compared with: tandem pass rate and tokens before and after, and a verdict. */
export function experimentRow(exp, results) {
  const byFile = new Map((results || []).map((r) => [r.file, r]));
  const runs = (exp.results || []).map((f) => byFile.get(f)).filter(Boolean);
  const after = runs[runs.length - 1] || null;
  if (!after) return { ...exp, tested: false, verdict: 'untested' };
  const before = after.compareTo ? byFile.get(after.compareTo) : null;
  const pick = (r) => (r ? (r.cases || []).filter((c) => c.arm === 'tandem' && !c.skipped && (!exp.case || c.case === exp.case)) : []);
  const a = pick(after);
  const names = new Set(a.map((c) => c.case));
  const b = pick(before).filter((c) => names.has(c.case));
  const rate = (xs) => { const t = sum(xs.map((c) => c.total || 0)); return t ? Math.round((100 * sum(xs.map((c) => c.passes || 0))) / t) : null; };
  const tokens = (xs) => { const k = xs.filter((c) => c.meanTokens != null); return k.length ? Math.round(sum(k.map((c) => c.meanTokens)) / k.length) : null; };
  const ra = rate(a); const rb = rate(b); const ta = tokens(a); const tb = tokens(b);
  let verdict = 'untested';
  if (ra != null && rb != null) {
    if (ra > rb) verdict = 'better';
    else if (ra < rb) verdict = 'worse';
    else if (ta != null && tb != null && ta < tb * 0.95) verdict = 'cheaper';
    else verdict = 'same';
  } else if (ra != null) verdict = 'no-baseline';
  return { ...exp, tested: true, before: { rate: rb, tokens: tb, file: before ? before.file : null }, after: { rate: ra, tokens: ta, file: after.file }, verdict, cases: [...names] };
}

/** Per model, per case: the latest tandem rate and tokens, for the model matrix. */
export function modelMatrix(results) {
  const models = [];
  const cells = new Map();
  for (const r of results || []) {
    if (r.unsupported || r.experiment) continue;
    for (const c of r.cases || []) {
      if (c.arm !== 'tandem' || c.skipped || c.rate == null || !c.model) continue;
      if (!models.includes(c.model)) models.push(c.model);
      const k = `${c.case}\u0000${c.model}`;
      if (!cells.has(k)) cells.set(k, { case: c.case, model: c.model, rate: c.rate, passAll: c.passAll, meanTokens: c.meanTokens });
    }
  }
  const caseNames = [...new Set([...cells.values()].map((x) => x.case))].sort();
  const cheapest = new Map();
  for (const name of caseNames) {
    const ok = models.map((m) => cells.get(`${name}\u0000${m}`)).filter((x) => x && x.passAll);
    ok.sort((a, b) => (a.meanTokens ?? Infinity) - (b.meanTokens ?? Infinity));
    if (ok.length) cheapest.set(name, ok[0].model);
  }
  return { models, cases: caseNames, cell: (name, m) => cells.get(`${name}\u0000${m}`) || null, cheapest };
}

export const SETTINGS_SCHEMA = 'bench.settings';
export const SETTINGS_VERSION = 1;
export const DEFAULT_SETTINGS = { testModel: '', judgeModel: '', suggestModel: '', maxRuns: 30 };
const MODEL_RE = /^[A-Za-z0-9._-]{1,60}\/[A-Za-z0-9._:/-]{1,120}$/;

/** Bench's own settings (models and budget) from its `settings` collection, with defaults. */
export function readSettings(env) {
  const item = env && Array.isArray(env.items) ? env.items.find((i) => i && i.id === 'prefs') : null;
  const s = { ...DEFAULT_SETTINGS, ...(item || {}) };
  for (const k of ['testModel', 'judgeModel', 'suggestModel']) if (s[k] && !MODEL_RE.test(s[k])) s[k] = '';
  s.maxRuns = Number.isInteger(Number(s.maxRuns)) && Number(s.maxRuns) >= 1 && Number(s.maxRuns) <= 500 ? Number(s.maxRuns) : 30;
  return s;
}

/** Checks the settings form; returns {ok, error, settings}. */
export function checkSettings(form) {
  const s = { testModel: String(form.testModel || '').trim(), judgeModel: String(form.judgeModel || '').trim(), suggestModel: String(form.suggestModel || '').trim(), maxRuns: Number(form.maxRuns) };
  for (const [k, label] of [['testModel', 'Test model'], ['judgeModel', 'Judge model'], ['suggestModel', 'Suggestion model']]) {
    if (s[k] && !MODEL_RE.test(s[k])) return { ok: false, error: `${label} must look like provider/model, or be empty.` };
  }
  if (!Number.isInteger(s.maxRuns) || s.maxRuns < 1 || s.maxRuns > 500) return { ok: false, error: 'Most runs per click must be 1 to 500.' };
  return { ok: true, settings: s };
}

/** The settings envelope to put, keeping the rest of what was read. */
export function settingsEnvelope(before, settings, now = Date.now()) {
  const base = before && before.schema === SETTINGS_SCHEMA ? before : { schema: SETTINGS_SCHEMA, version: SETTINGS_VERSION, rev: 0, items: [], deleted: {} };
  const items = (base.items || []).filter((i) => i && i.id !== 'prefs');
  items.push({ id: 'prefs', ...settings, updatedAt: now });
  return { ...base, items };
}
