/* Bench's HTML: pure functions from state to markup (main.js wires events). Every value from a results file is
   escaped. Status always has a word, never color alone (shared/brand/AGENTS.md). */
import { armTotals, caveats, compare, fmtDay, fmtPoints, fmtSeconds, headline, latestWithLift, tandemRate } from './model.js';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (r) => (r == null ? 'n/a' : `${r}%`);
const ARM = { tandem: 'Tandem', baseline: 'Plain prompt' };
const VERDICT_CLASS = { helps: 'ok', edge: 'ok', same: 'muted', worse: 'danger', none: 'muted' };

export const TABS = [
  { id: 'lift', label: 'Lift', path: '' },
  { id: 'history', label: 'History', path: 'history' },
  { id: 'cases', label: 'Cases', path: 'cases' }
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
      { act: 'go-cases', label: 'Set up a run' });
  }
  const h = headline(r);
  const t = armTotals(r);
  const notes = caveats(r);
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
    </tr>`;
  }).join('');
  return `<section class="hero-card" aria-labelledby="liftTitle">
      <div class="hero-num ${VERDICT_CLASS[h.verdict]}"><span class="big num">${esc(fmtPoints(h.points))}</span><span class="unit">points</span></div>
      <div class="hero-text">
        <h2 id="liftTitle" class="section-label">${esc(h.text)}.</h2>
        <p class="soft">${meta(r)}</p>
        <div class="bars" role="img" aria-label="Tandem ${pct(t.tandem.rate)}, plain prompt ${pct(t.baseline.rate)}">
          <div class="bar"><span class="bl">Tandem</span><span class="track"><span class="fill t" style="width:${t.tandem.rate || 0}%"></span></span><span class="num">${pct(t.tandem.rate)}</span></div>
          <div class="bar"><span class="bl">Plain prompt</span><span class="track"><span class="fill b" style="width:${t.baseline.rate || 0}%"></span></span><span class="num">${pct(t.baseline.rate)}</span></div>
        </div>
      </div>
    </section>
    ${notes.length ? `<ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <section class="block">
      <div class="block-head"><h2 class="section-label">By case</h2><button type="button" class="lnk" data-act="open-result" data-file="${esc(r.file)}">See every run</button></div>
      <div class="table-wrap"><table class="btable">
        <thead><tr><th scope="col">Case</th><th scope="col" class="num">Tandem</th><th scope="col" class="num">Plain prompt</th><th scope="col" class="num">Lift</th><th scope="col">Every run passed</th><th scope="col" class="num">Avg time</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="soft small">Lift is Tandem's pass rate minus the plain prompt's, in points. Both arms get the same workspace, repo map and repo guide, so it measures Tandem's phases. "Every run passed" means all ${esc(r.runsPerCase || '')} runs of the case passed: reliability, not luck.</p>
    </section>`;
}

export function historyHtml(st) {
  const list = (st.results || []).filter((r) => !r.unsupported);
  if (!list.length) return emptyHtml('No results yet', 'Each eval run writes a results file to <code>evals/results/</code> in your eng-agents folder. Commit the ones you want to keep as baselines.', { act: 'go-cases', label: 'Set up a run' });
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
        <div class="run-h">${pass(run.pass, run.pass ? 'Pass' : run.timedOut ? 'Timed out' : 'Fail')}<span class="soft">Run ${esc(run.run)}</span><span class="num soft">${esc(fmtSeconds(run.seconds))}</span>${run.log ? `<button type="button" class="lnk" data-act="copy" data-text="${esc(run.log)}">Copy log path</button>` : ''}</div>
        ${run.steps.length > 1 ? `<ol class="steps">${run.steps.map((s) => `<li class="${s.ok ? 'ok' : 'bad'}"><span class="sr">${s.ok ? 'done' : 'failed'}: </span>${esc(s.step)} <span class="soft num">${esc(fmtSeconds(s.seconds))}</span></li>`).join('')}</ol>` : ''}
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

export function casesHtml(st) {
  const cases = st.cases || [];
  if (!cases.length) return emptyHtml('No eval cases found', `Bench reads cases from <code>evals/cases/</code> in ${st.source ? `<code>${esc(st.source)}</code>` : 'your eng-agents folder'}.`, null);
  const f = st.form;
  const rows = cases.map((c) => `<li class="pick">
      <label><input type="checkbox" name="case" value="${esc(c.name)}"${f.cases.includes(c.name) ? ' checked' : ''}>
        <span class="pick-main"><code>${esc(c.name)}</code>${c.lift ? ' <span class="tag accent">lift</span>' : ''}${c.needs.map((n) => ` <span class="tag">needs ${esc(n)}</span>`).join('')}${c.steps > 1 ? ` <span class="tag">${esc(c.steps)} steps</span>` : ''}
        <span class="pick-desc soft">${esc(c.description)}</span></span>
      </label></li>`).join('');
  return `<form id="runForm" class="runform" novalidate>
    <section class="block">
      <div class="block-head"><h2 class="section-label">Cases</h2><span class="soft small">From <code>${esc(st.source || '')}</code></span></div>
      <ul class="picks">${rows}</ul>
    </section>
    <section class="block run-opts" aria-labelledby="runTitle">
      <h2 id="runTitle" class="section-label">Run</h2>
      <div class="fields">
        <label class="field"><span>Arms</span>
          <select name="arm">
            <option value="both"${f.arm === 'both' ? ' selected' : ''}>Both: show the lift</option>
            <option value="tandem"${f.arm === 'tandem' ? ' selected' : ''}>Tandem only</option>
            <option value="baseline"${f.arm === 'baseline' ? ' selected' : ''}>Plain prompt only</option>
          </select></label>
        <label class="field"><span>Runs per case</span><input name="runs" type="number" min="1" max="10" value="${esc(f.runs)}"></label>
        <label class="field grow"><span>Model</span><input name="model" type="text" placeholder="Your opencode default" value="${esc(f.model)}" spellcheck="false" autocomplete="off"></label>
      </div>
      <label class="check"><input type="checkbox" name="autoApprove"${f.autoApprove ? ' checked' : ''}> Approve anything not denied <span class="soft">(--auto; runs happen in throwaway folders with no remote)</span></label>
      ${st.formError ? `<p class="warn-line" role="alert">${esc(st.formError)}</p>` : ''}
      <div class="acts">
        <button type="submit" class="btn primary">Run in a terminal</button>
        <button type="button" class="btn" data-act="copy-command">Copy command</button>
      </div>
      <p class="soft small">The run happens in a terminal window you can see, in your eng-agents folder. Come back here when it finishes and press Refresh. Pick the same free model every time you compare.</p>
    </section>
  </form>`;
}

/** The whole page body under the header, for the current tab (or a result's runs). */
export function bodyHtml(st) {
  if (st.note) return emptyHtml(st.note.title, st.note.body, st.note.action || null);
  if (st.loading) return '<p class="soft loading">Reading Tandem\'s evals…</p>';
  if (st.error) return `<p class="warn-line" role="alert">${esc(st.error)}</p>`;
  if (st.view === 'result') return resultHtml(st);
  if (st.tab === 'history') return historyHtml(st);
  if (st.tab === 'cases') return casesHtml(st);
  return liftHtml(st);
}
