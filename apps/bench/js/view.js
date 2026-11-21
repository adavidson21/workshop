/* Bench's HTML: pure functions from state to markup (main.js wires events). Every value from a results file is
   escaped. Status always has a word, never color alone (shared/brand/AGENTS.md). */
import { commandHtml, improveHtml, overviewHtml, runHtml } from './suite-view.js';
import { armTotals, caveats, compare, efficiency, fmtCost, fmtDay, fmtPoints, fmtSeconds, fmtTokens, headline, latestWithLift, tandemRate } from './model.js';

/** A step that scripted answers to its questions (eng-agents Core 4.16.0): how many went, and if it still asked. */
export function answersNote(s) {
  if (!s || s.answered == null) return '';
  return `, ${s.answered} answer${s.answered === 1 ? '' : 's'} sent${s.stillAsking ? ', still asking' : ''}`;
}

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (r) => (r == null ? 'n/a' : `${r}%`);
const ARM = { tandem: 'Tandem', baseline: 'Plain prompt' };
const VERDICT_CLASS = { helps: 'ok', edge: 'ok', same: 'muted', worse: 'danger', none: 'muted' };

export const TABS = [
  { id: 'overview', label: 'Overview', path: '' },
  { id: 'improve', label: 'Improve', path: 'improve' },
  { id: 'history', label: 'History', path: 'history' },
  { id: 'run', label: 'Run', path: 'run' }
];

export function tabsHtml(active) {
  return TABS.map((t) => `<button type="button" data-tab="${t.id}"${t.id === active ? ' aria-current="page"' : ''}>${t.label}</button>`).join('');
}

function meta(r) {
  const bits = [r.model || 'opencode default', `Tandem ${r.tandem || '?'}`, r.runsPerCase ? `${r.runsPerCase} run${r.runsPerCase === 1 ? '' : 's'} per case` : null, fmtDay(r.date)];
  return bits.filter(Boolean).map(esc).join(' · ');
}

function pass(ok, label) {
  return `<span class="mark ${ok ? 'ok' : 'bad'}">${ok ? '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.3 5 8.6l4.5-5"/></svg>' : '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg>'}${esc(label || (ok ? 'Pass' : 'Fail'))}</span>`;
}

/** A note for a page with nothing to show yet, with at most one action. */
export function emptyHtml(title, body, action) {
  return `<div class="empty"><h2 class="section-label">${esc(title)}</h2><p>${body}</p>${action ? `<p><button type="button" class="btn primary" data-act="${esc(action.act)}">${esc(action.label)}</button></p>` : ''}</div>`;
}

export function liftHtml(st) {
  const r = latestWithLift(st.results);
  if (!r) {
    const any = (st.results || []).find((x) => !x.unsupported);
    return emptyHtml('No lift yet',
      `The lift compares Tandem with one plain prompt on the same model and the same task. ${any ? 'Your results so far ran the Tandem arm only.' : 'There are no eval results yet.'} Run <code>feature-outcome</code> with both arms to see it.`,
      { act: 'go-run', label: 'Set up a run' });
  }
  const h = headline(r);
  const t = armTotals(r);
  const notes = caveats(r);
  const eff = efficiency(r);
  const effLine = eff.tandem && eff.baseline
    ? `<p class="soft small eff">Tokens per passing run: Tandem ${eff.tandem.tokensPerPass == null ? 'n/a (no pass)' : esc(fmtTokens(eff.tandem.tokensPerPass))}, plain prompt ${eff.baseline.tokensPerPass == null ? 'n/a (no pass)' : esc(fmtTokens(eff.baseline.tokensPerPass))}.</p>`
    : '';
  const usage = r.cases.some((c) => c.usageKnown);
  const rows = r.lift.map((l) => {
    const tc = r.cases.find((c) => c.case === l.case && c.arm === 'tandem') || {};
    const bc = r.cases.find((c) => c.case === l.case && c.arm === 'baseline') || {};
    return `<tr>
      <th scope="row"><code>${esc(l.case)}</code></th>
      <td class="num">${pct(l.tandem)} <span class="soft">${tc.passes ?? '?'}/${tc.total ?? '?'}</span></td>
      <td class="num">${pct(l.baseline)} <span class="soft">${bc.passes ?? '?'}/${bc.total ?? '?'}</span></td>
      <td class="num lift ${l.lift > 0 ? 'up' : l.lift < 0 ? 'down' : ''}">${esc(fmtPoints(l.lift))}</td>
      <td>${pass(!!l.tandemAll, l.tandemAll ? 'Yes' : 'No')} <span class="soft">/</span> ${pass(!!l.baselineAll, l.baselineAll ? 'Yes' : 'No')}</td>
      <td class="num soft">${esc(fmtSeconds(tc.meanSeconds))} / ${esc(fmtSeconds(bc.meanSeconds))}</td>
      ${usage ? `<td class="num soft">${esc(fmtTokens(tc.meanTokens) || 'n/a')} / ${esc(fmtTokens(bc.meanTokens) || 'n/a')}</td>` : ''}
    </tr>`;
  }).join('');
  if (st.card) return heroOnly(r, h, t, effLine);
  return `<div class="block-head"><button type="button" class="lnk" data-act="back-overview">← Overview</button></div>
    <section class="hero-card" aria-labelledby="liftTitle">
      <div class="hero-num ${VERDICT_CLASS[h.verdict]}"><span class="big num">${esc(fmtPoints(h.points))}</span><span class="unit">points</span></div>
      <div class="hero-text">
        <h2 id="liftTitle" class="section-label">${esc(h.text)}.</h2>
        <p class="soft">${meta(r)}</p>
        <div class="bars" role="img" aria-label="Tandem ${pct(t.tandem.rate)}, plain prompt ${pct(t.baseline.rate)}">
          <div class="bar"><span class="bl">Tandem</span><span class="track"><span class="fill t" style="width:${t.tandem.rate || 0}%"></span></span><span class="num">${pct(t.tandem.rate)}</span></div>
          <div class="bar"><span class="bl">Plain prompt</span><span class="track"><span class="fill b" style="width:${t.baseline.rate || 0}%"></span></span><span class="num">${pct(t.baseline.rate)}</span></div>
        </div>
        ${effLine}
      </div>
    </section>
    ${notes.length ? `<ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <section class="block">
      <div class="block-head"><h2 class="section-label">By case</h2><button type="button" class="lnk" data-act="open-result" data-file="${esc(r.file)}">See every run</button></div>
      <div class="table-wrap"><table class="btable">
        <thead><tr><th scope="col">Case</th><th scope="col" class="num">Tandem</th><th scope="col" class="num">Plain prompt</th><th scope="col" class="num">Lift</th><th scope="col">Every run passed</th><th scope="col" class="num">Avg time</th>${usage ? '<th scope="col" class="num">Tokens per run</th>' : ''}</tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="soft small">Lift is Tandem's pass rate minus the plain prompt's, in points. Both arms get the same workspace, repo map and repo guide, so it measures Tandem's phases. "Every run passed" means all ${esc(r.runsPerCase || '')} runs of the case passed: reliability, not luck.</p>
    </section>`;
}

function heroOnly(r, h, t, effLine) {
  return `<section class="hero-card" aria-labelledby="liftTitle">
      <div class="hero-num ${VERDICT_CLASS[h.verdict]}"><span class="big num">${esc(fmtPoints(h.points))}</span><span class="unit">points</span></div>
      <div class="hero-text">
        <h2 id="liftTitle" class="section-label">${esc(h.text)}.</h2>
        <p class="soft">${meta(r)} · <button type="button" class="lnk" data-act="open-lift">By case</button></p>
        <div class="bars" role="img" aria-label="Tandem ${pct(t.tandem.rate)}, plain prompt ${pct(t.baseline.rate)}">
          <div class="bar"><span class="bl">Tandem</span><span class="track"><span class="fill t" style="width:${t.tandem.rate || 0}%"></span></span><span class="num">${pct(t.tandem.rate)}</span></div>
          <div class="bar"><span class="bl">Plain prompt</span><span class="track"><span class="fill b" style="width:${t.baseline.rate || 0}%"></span></span><span class="num">${pct(t.baseline.rate)}</span></div>
        </div>
        ${effLine}
      </div>
    </section>`;
}

/** The lift card for Overview's top, or nothing when no run had both arms. */
export function liftCardHtml(st) {
  return latestWithLift(st.results) ? liftHtml({ ...st, card: true }) : '';
}

export function historyHtml(st) {
  const list = (st.results || []).filter((r) => !r.unsupported);
  if (!list.length) return emptyHtml('No results yet', 'Each eval run writes a results file to <code>evals/results/</code> in your eng-agents folder. Commit the ones you want to keep as baselines.', { act: 'go-run', label: 'Set up a run' });
  const sel = st.compare || [];
  const rows = list.map((r) => {
    const h = headline(r);
    const on = sel.includes(r.file);
    return `<tr${on ? ' class="sel"' : ''}>
      <td><input type="checkbox" data-act="pick-compare" data-file="${esc(r.file)}" aria-label="Compare ${esc(r.file)}"${on ? ' checked' : ''}></td>
      <th scope="row"><button type="button" class="lnk" data-act="open-result" data-file="${esc(r.file)}">${esc(fmtDay(r.date))}</button></th>
      <td>${esc(r.tandem || '?')}</td>
      <td><code>${esc(r.model || 'default')}</code></td>
      <td>${esc(r.arms.map((a) => ARM[a] || a).join(', '))}</td>
      <td class="num">${pct(tandemRate(r))}</td>
      <td class="num lift ${h.points > 0 ? 'up' : h.points < 0 ? 'down' : ''}">${r.lift.length ? esc(fmtPoints(h.points)) : '<span class="soft">n/a</span>'}</td>
    </tr>`;
  }).join('');
  let cmp = '';
  if (sel.length === 2) {
    const [a, b] = sel.map((f) => list.find((r) => r.file === f)).sort((x, y) => ((x.date || '') < (y.date || '') ? -1 : 1));
    const rowsC = compare(a, b).map((c) => `<tr><th scope="row"><code>${esc(c.case)}</code></th><td>${esc(ARM[c.arm] || c.arm)}</td><td class="num">${pct(c.before)}</td><td class="num">${c.skipped ? `<span class="soft">skipped</span>` : pct(c.after)}</td><td class="num lift ${c.change > 0 ? 'up' : c.change < 0 ? 'down' : ''}">${c.change == null ? '<span class="soft">n/a</span>' : esc(c.change === 0 ? 'same' : fmtPoints(c.change))}</td></tr>`).join('');
    const drops = compare(a, b).filter((c) => c.arm === 'tandem' && c.change != null && c.change < 0).length;
    cmp = `<section class="block" aria-labelledby="cmpTitle">
      <div class="block-head"><h2 id="cmpTitle" class="section-label">${esc(fmtDay(a.date))} → ${esc(fmtDay(b.date))}</h2><button type="button" class="lnk" data-act="clear-compare">Clear</button></div>
      <p class="soft">${esc(a.tandem || '?')} on ${esc(a.model || 'default')}, then ${esc(b.tandem || '?')} on ${esc(b.model || 'default')}.${a.model !== b.model ? ' Different models: compare with care.' : ''}</p>
      ${drops ? `<p class="warn-line">${drops} Tandem case${drops === 1 ? '' : 's'} dropped. Read their failed checks before you keep this prompt change.</p>` : ''}
      <div class="table-wrap"><table class="btable"><thead><tr><th scope="col">Case</th><th scope="col">Arm</th><th scope="col" class="num">Before</th><th scope="col" class="num">After</th><th scope="col" class="num">Change</th></tr></thead><tbody>${rowsC}</tbody></table></div>
    </section>`;
  }
  return `${cmp}<section class="block">
      <div class="block-head"><h2 class="section-label">Every run</h2><span class="soft small">${sel.length === 2 ? '' : 'Tick two to compare them.'}</span></div>
      <div class="table-wrap"><table class="btable">
        <thead><tr><th scope="col"><span class="sr">Compare</span></th><th scope="col">Date</th><th scope="col">Tandem</th><th scope="col">Model</th><th scope="col">Arms</th><th scope="col" class="num">Tandem pass rate</th><th scope="col" class="num">Lift</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;
}

export function resultHtml(st) {
  const r = st.detail;
  if (!r) return st.detailError ? `<p class="warn-line">${esc(st.detailError)}</p>` : '<p class="soft loading">Reading the results file…</p>';
  if (r.unsupported) return `<p class="warn-line">This results file is version ${esc(r.version)}. This Workshop reads versions 1 and 2: update Workshop.</p>`;
  const groups = r.cases.map((c) => {
    if (c.skipped) return `<section class="case"><h3 class="case-h"><code>${esc(c.case)}</code> <span class="tag">${esc(ARM[c.arm])}</span></h3><p class="soft">Skipped: ${esc(c.skipped)}</p></section>`;
    const runs = c.runs.map((run) => `<li class="run">
        <div class="run-h">${pass(run.pass, run.pass ? 'Pass' : run.timedOut ? 'Timed out' : 'Fail')}<span class="soft">Run ${esc(run.run)}</span><span class="num soft">${esc(fmtSeconds(run.seconds))}</span>${run.tokens != null ? `<span class="num soft">${esc(fmtTokens(run.tokens))} tokens${run.cost ? `, ${esc(fmtCost(run.cost))}` : ''}</span>` : ''}${run.questions ? `<span class="tag warn">${esc(run.questions)} question${run.questions === 1 ? '' : 's'} asked</span>` : ''}${run.verifyFails ? `<span class="tag">${esc(run.verifyFails)} failed verify</span>` : ''}${run.log ? `<button type="button" class="lnk" data-act="copy" data-text="${esc(run.log)}">Copy log path</button>` : ''}</div>
        ${run.steps.length > 1 || run.steps.some((s) => s.answered != null) ? `<ol class="steps">${run.steps.map((s) => `<li class="${s.ok ? 'ok' : 'bad'}"><span class="sr">${s.ok ? 'done' : 'failed'}: </span>${esc(s.step)} <span class="soft num">${esc(fmtSeconds(s.seconds))}${s.tokens ? `, ${esc(fmtTokens(s.tokens))} tokens` : ''}${answersNote(s)}</span></li>`).join('')}</ol>` : ''}
        ${run.failed.length ? `<ul class="fails">${run.failed.map((f) => `<li><b>${esc(f.check)}</b>${f.detail ? `<span class="soft"> ${esc(f.detail)}</span>` : ''}</li>`).join('')}</ul>` : ''}
      </li>`).join('');
    return `<section class="case">
        <h3 class="case-h"><code>${esc(c.case)}</code> <span class="tag">${esc(ARM[c.arm])}</span> <span class="num">${esc(c.passes)}/${esc(c.total)}</span>${c.passAll ? ' <span class="soft">every run passed</span>' : ''}</h3>
        <ol class="runs">${runs}</ol>
      </section>`;
  }).join('');
  return `<div class="block-head"><button type="button" class="lnk" data-act="back">← Back</button></div>
    <p class="soft">${meta(r)} · <code>${esc(r.file)}</code></p>
    <p class="soft small">Logs live in a temp folder and are gone after a restart. Re-run with <code>-KeepWorkspaces</code> to keep each run's files too.</p>
    ${groups}`;
}

/** The whole page body under the header, for the current tab (or a result's runs). */
export function bodyHtml(st) {
  if (st.note) return emptyHtml(st.note.title, st.note.body, st.note.action || null);
  if (st.loading) return '<p class="soft loading">Reading Tandem\'s evals…</p>';
  if (st.error) return `<p class="warn-line" role="alert">${esc(st.error)}</p>`;
  if (st.view === 'result') return resultHtml(st);
  if (st.view === 'command') return commandHtml(st);
  if (st.view === 'lift') return liftHtml(st);
  if (st.tab === 'history') return historyHtml(st);
  if (st.tab === 'improve') return improveHtml(st);
  if (st.tab === 'run') return runHtml(st);
  return overviewHtml(st, liftCardHtml(st));
}
