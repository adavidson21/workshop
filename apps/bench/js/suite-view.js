/* Bench 2's pages for the whole suite: Overview, one command, Improve, and Run with its settings. Pure functions
   from state to markup; every value from eng-agents is escaped; status always has a word. */
import { fmtDay, fmtPoints, fmtTokens } from './model.js';
import { STATUS_WORDS, commandRows, coverage, experimentRow, failureGroups, modelMatrix } from './suite.js';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (r) => (r == null ? 'n/a' : `${r}%`);
const STATUS_CLASS = { failing: 'bad', stale: 'warn', 'never-run': 'muted', 'no-cases': 'muted', ok: 'ok' };

function statusTag(s) { return `<span class="state ${STATUS_CLASS[s] || 'muted'}">${esc(STATUS_WORDS[s] || s)}</span>`; }

export function overviewHtml(st, liftCard = '') {
  const rows = commandRows({ commands: st.commands, cases: st.cases, results: st.results, hashes: st.hashes });
  if (!rows.length) return `${liftCard}<p class="warn-line">No <code>evals/commands.json</code> in your eng-agents folder yet. Update Tandem (it ships with Core 4.1.0), or run <code>./evals/Get-PromptSize.ps1 -Write</code> there.</p>`;
  const cov = coverage(rows, st.guards);
  const needs = rows.filter((r) => r.status === 'failing' || r.status === 'stale').length;
  const body = rows.map((r) => `<tr>
      <th scope="row"><button type="button" class="lnk" data-act="open-command" data-command="${esc(r.command)}"><code>/${esc(r.command)}</code></button></th>
      <td>${statusTag(r.status)}</td>
      <td class="num">${r.cases.length || '<span class="soft">0</span>'}</td>
      <td class="num">${r.total ? `${pct(r.rate)} <span class="soft">${r.passes}/${r.total}</span>` : '<span class="soft">n/a</span>'}</td>
      <td>${r.passAll == null ? '<span class="soft">n/a</span>' : r.passAll ? '<span class="mark ok">Yes</span>' : '<span class="mark bad">No</span>'}</td>
      <td class="num soft">${esc(fmtTokens(r.meanTokens) || 'n/a')}</td>
      <td class="num soft">${esc(fmtTokens(r.tokens))}${r.readTokens ? ` <span class="soft">+${esc(fmtTokens(r.readTokens))}</span>` : ''}</td>
    </tr>`).join('');
  return `${liftCard}
    <section class="stats" aria-label="Coverage">
      <div class="stat"><span class="num big2">${cov.covered}<span class="soft">/${cov.commands}</span></span><span class="soft">commands with cases</span></div>
      <div class="stat"><span class="num big2">${cov.guarded}<span class="soft">/${cov.agents}</span></span><span class="soft">agents guarded (checked in CI)</span></div>
      <div class="stat"><span class="num big2">${needs}</span><span class="soft">need you: failing or prompt changed</span></div>
    </section>
    <section class="block">
      <div class="block-head"><h2 class="section-label">Every command</h2><span class="soft small">What needs you first</span></div>
      <div class="table-wrap"><table class="btable">
        <thead><tr><th scope="col">Command</th><th scope="col">State</th><th scope="col" class="num">Cases</th><th scope="col" class="num">Pass rate</th><th scope="col">Every run passed</th><th scope="col" class="num">Tokens per run</th><th scope="col" class="num">Prompt (up front + read)</th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>
      <p class="soft small">"Prompt changed" means a file the command loads or reads changed since its cases last ran: run the Affected preset. Prompt size is estimated at 4 characters per token.</p>
    </section>`;
}

export function commandHtml(st) {
  const rows = commandRows({ commands: st.commands, cases: st.cases, results: st.results, hashes: st.hashes });
  const r = rows.find((x) => x.command === st.commandName);
  if (!r) return `<div class="block-head"><button type="button" class="lnk" data-act="back-overview">← Overview</button></div><p class="warn-line">No command <code>${esc(st.commandName)}</code>.</p>`;
  const caseRows = r.cases.map((c) => {
    const l = c.latest;
    return `<tr><th scope="row"><code>${esc(c.name)}</code> <span class="tag">${esc(c.kind || 'behavior')}</span></th><td>${statusTag(c.state)}</td>
      <td class="num">${l ? `${pct(l.entry.rate)} <span class="soft">${l.entry.passes}/${l.entry.total}</span>` : '<span class="soft">n/a</span>'}</td>
      <td class="num soft">${l ? esc(fmtTokens(l.entry.meanTokens) || 'n/a') : ''}</td>
      <td>${l ? `<button type="button" class="lnk" data-act="open-result" data-file="${esc(l.file)}">${esc(fmtDay(l.date))}</button>` : ''}</td></tr>`;
  }).join('');
  return `<div class="block-head"><button type="button" class="lnk" data-act="back-overview">← Overview</button></div>
    <section class="hero-card slim">
      <div><h2 class="section-label"><code>/${esc(r.command)}</code> ${statusTag(r.status)}</h2>
      <p class="soft">Agent ${esc(r.agent || 'default')} · loads about ${esc(fmtTokens(r.tokens))} tokens up front${r.readTokens ? `, reads about ${esc(fmtTokens(r.readTokens))} more while it runs` : ''}</p></div>
      <div class="acts">
        ${r.cases.length ? `<button type="button" class="btn primary" data-act="run-command" data-command="${esc(r.command)}">Run its cases</button>` : ''}
        <button type="button" class="btn" data-act="trim" data-command="${esc(r.command)}">Suggest trims</button>
      </div>
    </section>
    <section class="block"><h2 class="section-label">Cases</h2>
      ${r.cases.length ? `<div class="table-wrap"><table class="btable"><thead><tr><th scope="col">Case</th><th scope="col">State</th><th scope="col" class="num">Pass rate</th><th scope="col" class="num">Tokens per run</th><th scope="col">Last run</th></tr></thead><tbody>${caseRows}</tbody></table></div>`
        : `<p class="soft">No cases use this command yet. Add one in eng-agents' <code>evals/cases/</code> (an <code>expect</code> block is enough; see evals/README.md).</p>`}
    </section>
    <section class="block"><h2 class="section-label">Files it loads and reads</h2>
      <ul class="files">${r.files.map((f) => `<li><code>${esc(f)}</code></li>`).join('')}</ul>
    </section>`;
}

export function improveHtml(st) {
  const groups = failureGroups(st.details || []);
  const exps = (st.experiments || []).map((e) => experimentRow(e, st.results));
  const open = exps.filter((e) => e.status === 'proposed');
  const done = exps.filter((e) => e.status !== 'proposed').slice(0, 10);
  const noModel = !st.settings.suggestModel;
  const gHtml = groups.length ? groups.map((g) => `<li class="group">
      <div class="group-h"><b>${esc(g.check)}</b> <span class="soft">${g.runs} failed run${g.runs === 1 ? '' : 's'} in ${g.cases.length} case${g.cases.length === 1 ? '' : 's'}</span></div>
      <div class="group-cases">${g.cases.map((c) => `<span class="pickcase"><code>${esc(c.name)}</code> <button type="button" class="lnk" data-act="suggest" data-case="${esc(c.name)}" data-file="${esc(c.file)}"${noModel ? ' disabled' : ''}>Suggest a fix</button></span>`).join('')}</div>
    </li>`).join('') : '<li class="soft">Nothing failing in the latest runs.</li>';
  const vWord = { better: 'Better', worse: 'Worse', cheaper: 'Same passes, fewer tokens', same: 'No change', 'no-baseline': 'Nothing to compare with', untested: 'Not tested yet' };
  const vClass = { better: 'ok', cheaper: 'ok', worse: 'bad', same: 'muted', 'no-baseline': 'muted', untested: 'muted' };
  const eRow = (e) => `<li class="exp">
      <div class="exp-h"><span class="tag">${esc(e.kind)}</span> <code>/${esc(e.command)}</code> <span class="state ${vClass[e.verdict]}">${esc(vWord[e.verdict])}</span>${e.status !== 'proposed' ? ` <span class="tag">${esc(e.status)}</span>` : ''}</div>
      <p class="exp-why">${esc(e.reason)}</p>
      ${e.tested ? `<p class="soft small num">Pass rate ${pct(e.before.rate)} → ${pct(e.after.rate)} · tokens per run ${esc(fmtTokens(e.before.tokens) || 'n/a')} → ${esc(fmtTokens(e.after.tokens) || 'n/a')}</p>` : ''}
      ${e.status === 'proposed' ? `<div class="acts">
        <button type="button" class="btn" data-act="test-exp" data-id="${esc(e.id)}">${e.tested ? 'Test again' : 'Test it'}</button>
        <button type="button" class="btn" data-act="keep-exp" data-id="${esc(e.id)}">Keep</button>
        <button type="button" class="btn" data-act="drop-exp" data-id="${esc(e.id)}">Drop</button>
      </div>` : ''}
    </li>`;
  return `<section class="block">
      <div class="block-head"><h2 class="section-label">What fails</h2><span class="soft small">From each failing case's latest run</span></div>
      ${noModel ? '<p class="warn-line">Pick a suggestion model in Run, Settings, to get fix suggestions. Any provider/model works, free or paid.</p>' : ''}
      <ul class="groups">${gHtml}</ul>
    </section>
    <section class="block">
      <div class="block-head"><h2 class="section-label">Experiments</h2><span class="soft small">${open.length} open</span></div>
      ${open.length ? `<ul class="exps">${open.map(eRow).join('')}</ul>` : '<p class="soft">No open experiments. Suggest a fix above, or Suggest trims from a command.</p>'}
      <p class="soft small">Each experiment changes one prompt file on a scratch copy of Tandem; your real Tandem is not touched until you press Keep, which copies the file into your eng-agents folder for you to review and commit.</p>
    </section>
    ${done.length ? `<section class="block"><h2 class="section-label">Kept and dropped</h2><ul class="exps">${done.map(eRow).join('')}</ul></section>` : ''}`;
}

export function modelsHtml(st) {
  const m = modelMatrix(st.results);
  if (m.models.length < 2) return '<p class="soft small">Run the same cases on two or more models (Models in the run form) to see which is cheapest per case while still passing every run.</p>';
  const rows = m.cases.map((name) => `<tr><th scope="row"><code>${esc(name)}</code></th>${m.models.map((mod) => {
    const c = m.cell(name, mod);
    return `<td class="num">${c ? `${pct(c.rate)}${c.passAll ? '' : ' <span class="soft">flaky</span>'} <span class="soft">${esc(fmtTokens(c.meanTokens))}</span>${m.cheapest.get(name) === mod ? ' <span class="tag accent">cheapest that passes</span>' : ''}` : '<span class="soft">n/a</span>'}</td>`;
  }).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table class="btable"><thead><tr><th scope="col">Case</th>${m.models.map((x) => `<th scope="col" class="num"><code>${esc(x)}</code></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

const PRESET_TEXT = {
  affected: ['Affected', 'Only cases whose prompts changed since they last ran, 1 run each. Use it after you change a prompt.'],
  release: ['Release', 'Every case, Tandem only, 3 runs, compared with the newest results. Use it before a Tandem release.'],
  lift: ['Lift', 'Tandem against one plain prompt on the outcome cases. Use it when you want proof.'],
  custom: ['Pick cases', 'Choose the cases, arms and runs yourself.']
};

export function runHtml(st) {
  const f = st.form;
  const s = st.settings;
  const presets = Object.entries(PRESET_TEXT).map(([id, [label]]) => `<button type="button" class="chip" data-act="preset" data-preset="${id}" aria-pressed="${f.preset === id}">${esc(label)}</button>`).join('');
  const cases = (st.cases || []).map((c) => `<li class="pick"><label><input type="checkbox" name="case" value="${esc(c.name)}"${f.cases.includes(c.name) ? ' checked' : ''}>
      <span class="pick-main"><code>${esc(c.name)}</code> <span class="tag${c.lift ? ' accent' : ''}">${esc(c.kind || 'behavior')}</span>${(c.commands || []).map((x) => ` <span class="tag">/${esc(x)}</span>`).join('')}${c.needs.map((n) => ` <span class="tag">needs ${esc(n)}</span>`).join('')}${c.answers ? ` <span class="tag" title="Answers the command's questions with ${c.answers} scripted answer${c.answers === 1 ? '' : 's'}">answers ${c.answers}</span>` : ''}
      <span class="pick-desc soft">${esc(c.description)}</span></span></label></li>`).join('');
  const affected = (st.affected || []).length;
  return `<form id="runForm" class="runform" novalidate>
    <section class="block run-opts" aria-labelledby="runTitle">
      <h2 id="runTitle" class="section-label">Run</h2>
      <div class="chips" role="group" aria-label="Run kind">${presets}</div>
      <p class="soft small">${esc(PRESET_TEXT[f.preset][1])}${f.preset === 'affected' ? ` Right now: ${affected} case${affected === 1 ? '' : 's'}.` : ''}</p>
      <div class="fields">
        ${f.preset === 'custom' ? `<label class="field"><span>Arms</span><select name="arm">
          <option value="tandem"${f.arm === 'tandem' ? ' selected' : ''}>Tandem only</option>
          <option value="both"${f.arm === 'both' ? ' selected' : ''}>Both: show the lift</option>
          <option value="baseline"${f.arm === 'baseline' ? ' selected' : ''}>Plain prompt only</option></select></label>` : ''}
        <label class="field"><span>Runs per case</span><input name="runs" type="number" min="1" max="10" value="${esc(f.runs)}"></label>
        <label class="field grow"><span>Models</span><input name="models" type="text" placeholder="${esc(s.testModel || 'Your opencode default')}" value="${esc(f.models)}" spellcheck="false" autocomplete="off"></label>
      </div>
      <label class="check"><input type="checkbox" name="judge"${f.judge ? ' checked' : ''}${s.judgeModel ? '' : ' disabled'}> Grade writing with the judge ${s.judgeModel ? `<code>${esc(s.judgeModel)}</code>` : '<span class="soft">(pick a judge model in Settings below)</span>'}</label>
      <label class="check"><input type="checkbox" name="autoApprove"${f.autoApprove ? ' checked' : ''}> Approve anything not denied <span class="soft">(--auto; runs happen in throwaway folders with no remote)</span></label>
      ${st.formError ? `<p class="warn-line" role="alert">${esc(st.formError)}</p>` : ''}
      <div class="acts">
        <button type="submit" class="btn primary">Run in a terminal</button>
        <button type="button" class="btn" data-act="copy-command">Copy command</button>
      </div>
      <p class="soft small">Several models: separate them with commas (the model matrix). Bench refuses more than ${esc(s.maxRuns)} model runs per click; change that in Settings.</p>
    </section>
    ${f.preset === 'custom' || f.preset === 'lift' ? `<section class="block"><div class="block-head"><h2 class="section-label">Cases</h2><span class="soft small">From <code>${esc(st.source || '')}</code></span></div><ul class="picks">${cases}</ul></section>` : ''}
  </form>
  <section class="block"><h2 class="section-label">Models compared</h2>${modelsHtml(st)}</section>
  <form id="settingsForm" class="block run-opts" novalidate aria-labelledby="setTitle">
    <h2 id="setTitle" class="section-label">Settings</h2>
    <div class="fields">
      <label class="field grow"><span>Test model</span><input name="testModel" type="text" placeholder="Your opencode default" value="${esc(s.testModel)}" spellcheck="false" autocomplete="off"></label>
      <label class="field grow"><span>Judge model</span><input name="judgeModel" type="text" placeholder="provider/model" value="${esc(s.judgeModel)}" spellcheck="false" autocomplete="off"></label>
      <label class="field grow"><span>Suggestion model</span><input name="suggestModel" type="text" placeholder="provider/model" value="${esc(s.suggestModel)}" spellcheck="false" autocomplete="off"></label>
      <label class="field"><span>Most runs per click</span><input name="maxRuns" type="number" min="1" max="500" value="${esc(s.maxRuns)}"></label>
    </div>
    ${st.settingsError ? `<p class="warn-line" role="alert">${esc(st.settingsError)}</p>` : ''}
    <div class="acts"><button type="submit" class="btn">Save settings</button></div>
    <p class="soft small">Free models work for all three; a stronger paid model usually judges and suggests better. Before trusting a judge model, run <code>./evals/Test-Judge.ps1 -Model &lt;it&gt;</code> in your eng-agents folder: it must pass the good examples and fail the bad ones.</p>
  </form>`;
}
