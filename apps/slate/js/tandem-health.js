/* Loom: Health > Tandem. Is Tandem helping? Pure HTML builders for the opencode connector's tandem.health answer
   (Workshop docs/tandem-health.md). Every number is computed on this computer from .work and the eval results. */
import { esc } from './model.js';

const pct = (v) => (v == null ? 'n/a' : `${v}%`);
const val = (v, suffix = '') => (v == null ? 'n/a' : `${v}${suffix}`);
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const RANGES = [['', 'All time'], ['90', 'Last 90 days'], ['30', 'Last 30 days']];

/** A gate approved as written this often, over this many approvals, may be a rubber stamp (docs/pipeline.md, Measuring the pipeline). */
export const STAMP_RATE = 80;
export const STAMP_MIN = 5;

function tile(big, label, note = '') {
  return `<div class="ttile"><p class="big">${esc(big)}</p><p>${esc(label)}</p>${note ? `<p class="soft small">${esc(note)}</p>` : ''}</div>`;
}

function rangeBar(range) {
  return `<div class="trange" role="group" aria-label="Time range">${RANGES.map(([k, label]) =>
    `<button type="button" class="btn${k === (range || '') ? ' on' : ''}" data-act="tandem-range" data-id="${k}" aria-pressed="${k === (range || '')}">${esc(label)}</button>`).join('')}
    <button type="button" class="btn" data-act="tandem-refresh">Refresh</button></div>`;
}

export function pipelineHtml(p) {
  const s = p.summary;
  if (!s.items) return '<p class="soft">No work items yet. Numbers show up once items go through <code>/start</code>, and fill in as they reach <code>/pr</code>.</p>';
  const gates = Object.entries(p.gates || {});
  const gateRows = gates.map(([file, g]) => {
    const stamp = g.unchangedRate != null && g.unchangedRate >= STAMP_RATE && g.approvals >= STAMP_MIN;
    return `<tr><th scope="row">${esc(file)}.md</th><td class="num">${g.approvals}</td><td class="num">${g.unchanged}</td><td class="num">${g.edited}</td>
      <td class="num${stamp ? ' warn' : ''}">${pct(g.unchangedRate)}${stamp ? ' <span class="chip warn">rubber stamp?</span>' : ''}</td></tr>`;
  }).join('');
  const items = (p.items || []).slice().sort((a, b) => String(b.started || '').localeCompare(String(a.started || ''))).slice(0, 12);
  const itemRows = items.map(i => `<tr><th scope="row"><button type="button" class="lnk" data-act="open-run" data-id="${esc(i.id + '-' + i.name)}">${esc(i.id)}</button> <span class="soft">${esc(i.name.replace(/-/g, ' '))}</span></th>
    <td>${esc(i.lane)}${i.quickEscalated ? ' <span class="chip soft">stepped up</span>' : ''}</td><td class="num">${val(i.daysToPr)}</td><td class="num">${i.rounds.review}</td>
    <td class="num${i.findings.blocker ? ' warn' : ''}">${val(i.findings.blocker)}</td><td class="num">${i.verifyFails}</td></tr>`).join('');
  return `<div class="ttiles">
      ${tile(val(s.medianDaysToPr, s.medianDaysToPr === 1 ? ' day' : ' days'), 'Median, /start to /pr', s.reachedPr ? `Over ${plural(s.reachedPr, 'item')}.` : 'Nothing has reached /pr yet.')}
      ${tile(pct(s.multiReviewRate), 'Needed a second review', 'Problems found late.')}
      ${tile(pct(s.verifyFailRate), 'Task runs that failed verify', `${plural(s.doTaskRuns, '/do-task run')}. ${plural(s.fullSuiteFails, 'full-suite failure')} caught before review.`)}
      ${tile(s.questions == null ? 'n/a' : `${s.questions} / ${s.assumptions}`, 'Questions / assumptions', 'Asked you versus decided and wrote down.')}
    </div>
    <h3>Gates</h3>
    ${gates.length ? `<table class="htable"><thead><tr><th>Gate</th><th class="num">Approvals</th><th class="num">As written</th><th class="num">Edited first</th><th class="num">As-written rate</th></tr></thead><tbody>${gateRows}</tbody></table>
      <p class="soft small">A gate you approve as written ${STAMP_RATE}% of the time or more, over ${STAMP_MIN} approvals or more, may be a rubber stamp: consider the quick lane for that kind of work.</p>`
      : '<p class="soft">No approvals with draft hashes yet (Tandem Core 2.22.0 and later).</p>'}
    <h3>Recent items</h3>
    <table class="htable"><thead><tr><th>Item</th><th>Lane</th><th class="num">Days to /pr</th><th class="num">Reviews</th><th class="num">Blockers</th><th class="num">Verify fails</th></tr></thead><tbody>${itemRows}</tbody></table>`;
}

export function learningHtml(p, f) {
  const cats = Object.entries(p.summary.findingCategories || {}).sort((a, b) => b[1] - a[1]);
  const reps = (f.patterns || []).filter(x => x.repeats).slice(0, 6);
  return `<div class="ttiles">
      ${tile(String(f.itemsReviewed || 0), 'Items reviewed', `${plural((f.findings || []).length, 'finding')} across every review round.`)}
      ${tile(`${p.summary.retros} of ${p.summary.reachedPr}`, 'Items with a /retro', 'Of the items that reached /pr.')}
    </div>
    <h3>Mistakes that repeat</h3>
    ${reps.length ? `<ul class="treps">${reps.map(x => `<li><b>${esc(x.repo || 'No repo')}</b>, ${esc(x.category)}: ${plural(x.itemCount, 'item')}, ${plural(x.findings, 'finding')}${x.blockers ? `, ${plural(x.blockers, 'Blocker')}` : ''}
        <span class="soft small">${esc(x.examples[0] || '')}</span></li>`).join('')}</ul>
        <p class="soft small">Run <code>/retro --since &lt;date&gt;</code> to turn these into rules.</p>`
      : '<p class="soft">Nothing repeats yet: no repo and category shows up in two items.</p>'}
    <h3>Findings by category</h3>
    ${cats.length ? `<table class="htable"><thead><tr><th>Category</th><th class="num">Findings</th></tr></thead><tbody>${cats.map(([k, n]) => `<tr><th scope="row">${esc(k)}</th><td class="num">${n}</td></tr>`).join('')}</tbody></table>`
      : '<p class="soft">No categorized findings yet (review.md files from Tandem Core 2.23.0 and later).</p>'}`;
}

export function promptsHtml(evals) {
  if (!evals) return '<p class="soft">Tandem\'s install record was not found, so there is nowhere to read eval results from. Install Tandem from its repo (<code>./install.ps1</code>).</p>';
  const { latest, previous } = evals;
  if (!latest) return '<p class="soft">No eval results yet. In your eng-agents folder: <code>./install.ps1</code>, then <code>./evals/Invoke-Evals.ps1</code>.</p>';
  const prev = Object.fromEntries(((previous && previous.cases) || []).filter(c => c.rate != null).map(c => [c.case, c.rate]));
  const rows = latest.cases.map(c => {
    if (c.skipped) return `<tr><th scope="row">${esc(c.case)}</th><td colspan="3" class="soft">Skipped: ${esc(c.skipped)}</td></tr>`;
    const was = Object.prototype.hasOwnProperty.call(prev, c.case) ? prev[c.case] : null;
    const d = was == null || c.rate == null ? null : c.rate - was;
    return `<tr><th scope="row">${esc(c.case)}</th><td class="num">${c.passes}/${c.total}</td><td class="num">${pct(c.rate)}</td>
      <td class="num${d != null && d < 0 ? ' warn' : ''}">${d == null ? 'n/a' : d === 0 ? 'same' : (d > 0 ? '+' : '') + d}</td></tr>`;
  }).join('');
  const drops = latest.cases.filter(c => Object.prototype.hasOwnProperty.call(prev, c.case) && c.rate != null && c.rate < prev[c.case]).length;
  return `<p>Tandem ${esc(latest.tandem || '?')}, ${esc(latest.model || 'default model')}, ${esc(String(latest.runsPerCase || '?'))} runs per case, ${esc((latest.date || '').slice(0, 10))}${previous ? `, compared with ${esc(previous.tandem || '?')} on ${esc((previous.date || '').slice(0, 10))}` : ''}.</p>
    ${drops ? `<p class="warn">${plural(drops, 'case')} dropped. Read their failed checks before releasing.</p>` : ''}
    <table class="htable"><thead><tr><th>Case</th><th class="num">Passed</th><th class="num">Rate</th><th class="num">Change</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function setupHtml(setup) {
  const i = setup.install;
  const g = setup.repoGuides || { total: 0, missing: [], todo: [] };
  return `<table class="htable"><tbody>
      <tr><th scope="row">Tandem</th><td>${i ? `${esc(i.version || '?')}${i.commit ? ` <span class="soft">(${esc(String(i.commit).slice(0, 7))})</span>` : ''}` : '<span class="warn">Not installed from a repo (no install record)</span>'}</td></tr>
      <tr><th scope="row">Installed</th><td>${i && i.installed ? esc(String(i.installed).slice(0, 10)) : 'n/a'}</td></tr>
      <tr><th scope="row">Workspace</th><td><code>${esc(setup.workspace || 'not set')}</code></td></tr>
      <tr><th scope="row">Repo guides</th><td>${g.total ? `${g.total - g.missing.length} of ${g.total} repos` : 'No repos found'}</td></tr>
    </tbody></table>
    ${g.missing.length ? `<p class="warn">No repo guide: ${g.missing.map(r => `<code>${esc(r)}</code>`).join(', ')}. Run <code>/onboard-repo &lt;folder&gt;</code>.</p>` : ''}
    ${g.todo.length ? `<p class="warn">Still has TODO(you): ${g.todo.map(r => `<code>${esc(r)}</code>`).join(', ')}. Agents work carefully around gaps; fill them in.</p>` : ''}`;
}

/** The Tandem card's body: a note, loading, or the four sections. */
export function tandemHealthHtml(st) {
  if (!st || st.note) return `<p class="soft">${esc((st && st.note) || 'Tandem health comes from the opencode connector.')}</p>`;
  if (!st.data) return st.error ? `<p class="warn">${esc(st.error)}</p>` : '<p class="loading">Reading .work…</p>';
  const d = st.data;
  if (d.version !== 1) return '<p class="warn">This Workshop reads Tandem health version 1. Update Workshop or Tandem so they match.</p>';
  return `${rangeBar(st.range)}${st.error ? `<p class="warn">${esc(st.error)}</p>` : ''}
    <div class="tgrid">
      <section class="tsec wide"><h3 class="tsh">Pipeline</h3>${pipelineHtml(d.pipeline)}</section>
      <section class="tsec"><h3 class="tsh">Learning loop</h3>${learningHtml(d.pipeline, d.findings)}</section>
      <section class="tsec"><h3 class="tsh">Prompts</h3>${promptsHtml(d.evals)}</section>
      <section class="tsec"><h3 class="tsh">Setup</h3>${setupHtml(d.setup)}</section>
    </div>
    <p class="soft small">Read on this computer from <code>.work</code> and your eval results; nothing is stored or sent anywhere.</p>`;
}
