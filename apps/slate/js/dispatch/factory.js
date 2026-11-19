/* The software factory in Loom (Loom 6.2.0, opencode connector 1.21.0; plan: claude/software-factory-v1-plan.md in
   the Workshop project). You touch a build twice: approve the plan, then publish the PR.
   - Publish (Gate 2): on a ready build, what came out (UI checks, review questions) and one Publish button that pushes
     every branch and opens the PRs. Publish all ready does it for every build with nothing to answer.
   - Teach: knowledge gaps Tandem logged instead of asking (state.gaps). One answer each; /teach writes it where it
     belongs and builds waiting on it carry on.
   - Overlap: at approval, a build that changes the same files as another offers Build after that one.
   No DOM: main.js paints what these return and handles the clicks. */
import { S } from './state.js';
import { h, md, itemForFolder } from './view.js';
import { outsideMark } from '../../../../shared/outside.js';

const KIND_NAMES = { fact: 'Fact', term: 'Term', repo: 'Repo', process: 'Process' };

// ------------------------------------------------------------------ Teach
/** The open gaps, newest first. */
export function teachList() {
  const g = S.D && S.D.gaps;
  return g && Array.isArray(g.open) ? g.open : [];
}
export const teachCount = () => teachList().length;
/** Gaps a build is stopped on (no safe assumption), counted as your turn. */
export const teachBlocking = () => teachList().filter(g => !g.assumed && !g.sent).length;

function gapRow(g) {
  const busy = (S.ui.busy && S.ui.busy['gap:' + g.id]) || !!g.sent;
  const key = 'teach:' + g.id;
  const draft = S.ui.drafts[key] || '';
  const meta = [g.product, g.source ? 'from ' + g.source : '', g.date].filter(Boolean).map(h).join(' · ');
  const how = g.assumed ? `<p class="obs-meta">Tandem assumed: ${h(g.assumed)}. It kept going; your answer is kept for next time.</p>`
    : '<p class="obs-meta"><b>A build is waiting on this.</b> It carries on once you answer.</p>';
  const body = g.sent
    ? '<p class="dim">Saving your answer. Tandem writes it where it belongs, then this card goes away.</p>'
    : `<textarea id="t-${h(g.id)}" rows="2" aria-label="Your answer to ${h(g.id)}" data-draft="${h(key)}" placeholder="Answer once; Tandem remembers it">${h(draft)}</textarea>` +
      `<div class="row"><button type="button" class="btn primary" data-teach="${h(g.id)}"${busy ? ' disabled' : ''}>Teach</button></div>`;
  return `<li class="obs gap" data-gap="${h(g.id)}"><span class="obs-kind k-${h(g.kind)}">${h(KIND_NAMES[g.kind] || 'Fact')}</span>` +
    `<div class="obs-body"><p class="obs-text">${h(g.question)}</p><p class="obs-meta">${meta}</p>${how}${body}</div></li>`;
}

/** The Teach list, in place of the lanes while its chip is on. */
export function teachHtml() {
  const list = teachList().slice().sort((a, b) => ((a.assumed ? 1 : 0) - (b.assumed ? 1 : 0)) || b.n - a.n);
  if (!list.length) return '<div class="empty small"><p>Nothing to teach right now. When Tandem needs a fact it cannot find, it asks here once instead of in the middle of a build.</p></div>';
  return `<section class="noticed teach" aria-label="Teach"><p class="hint">What Tandem needed and could not find. Answer once: it goes in the product note, the handbook or the repo guide, and is never asked again.</p>` +
    `<ul class="obs-list" role="list">${list.map(gapRow).join('')}</ul></section>`;
}

// ------------------------------------------------------------------ Publish (Gate 2)
/** Gate 2 info for a run, from state.publish (connector 1.21.0), or null. */
export const publishOf = it => (it && S.D && S.D.publish && S.D.publish[it.folder]) || null;

/** Ready to publish with nothing to answer and no failed UI check: what Publish all ready would send. */
export function readyClean(it) {
  const p = publishOf(it);
  return !!p && p.ready && !p.published && !p.questions.length && !p.ui.some(u => u.name !== 'before' && u.verdict === 'fail');
}
export const readyCleanCount = (items) => (items || []).filter(readyClean).length;

const VERDICT = { pass: ['ok', 'UI checks passed'], fail: ['bad', 'UI checks found problems'], skipped: ['warn', 'UI checks skipped'] };
function uiHtml(it, p) {
  const after = p.ui.filter(u => u.name !== 'before');
  if (!after.length) return '';
  return after.map(u => {
    const [cls, word] = VERDICT[u.verdict] || VERDICT.skipped;
    const before = p.ui.find(x => x.name === 'before');
    const shots = u.pages.filter(pg => pg.file).slice(0, 12).map(pg => {
      const b = before && before.pages.find(x => x.path === pg.path && x.width === pg.width && x.file);
      const changed = pg.changedPct > 0;
      const k = `${it.folder}|${pg.file}`;
      const open = S.ui.open['shot:' + k];
      const img = open ? shotImgs(it, b && b.file, pg.file, pg.diff) : '';
      return `<li><button type="button" class="lnk plain" data-ui-shot="${h(k)}" data-ui-before="${h(b && b.file || '')}" data-ui-diff="${h(pg.diff || '')}" aria-expanded="${!!open}">${h(pg.path)} at ${pg.width}px${changed ? ` <span class="flag warn">${h(String(pg.changedPct))}% changed</span>` : ''}</button>${img}</li>`;
    }).join('');
    const probs = u.problems.length ? `<ul class="gone">${u.problems.map(x => `<li>${h(x)}</li>`).join('')}</ul>` : '';
    return `<div class="pub-ui"><p><span class="flag ${cls}">${h(word)}</span>${u.reason ? ' ' + h(u.reason) : ''}</p>${probs}${shots ? `<ul class="pub-shots" role="list">${shots}</ul>` : ''}</div>`;
  }).join('');
}
function shotImgs(it, before, after, diff) {
  const src = f => (S.ui.shots || {})[`${it.folder}|${f}`];
  const one = (f, label) => !f ? '' : src(f) ? `<figure><img src="${h(src(f))}" alt="${h(label)}" loading="lazy"><figcaption>${h(label)}</figcaption></figure>` : `<figure class="dim">Loading ${h(label.toLowerCase())}</figure>`;
  return `<div class="pub-imgs">${one(before, 'Before')}${one(after, 'After')}${one(diff, 'What changed')}</div>`;
}

/** The Publish block on a ready build's page and panel. */
export function publishHtml(it) {
  const p = publishOf(it);
  if (!p) return '';
  if (p.published) {
    const links = (p.published.repos || []).map(r => r.pr ? `<a class="btn" href="${h(r.pr)}" target="_blank" rel="noopener">Open the PR for ${h(r.repo)}</a>` : `<span class="dim">${h(r.repo)}: pushed (no PR link)</span>`).join('');
    return `<div class="pub done"><p><span class="flag ok">Published</span> ${h(new Date(p.published.at).toLocaleString())}. Create each PR if you have not yet, then Remove the run once it merges.</p><div class="row">${links}</div></div>`;
  }
  if (!p.ready) return '';
  const q = p.questions.length ? `<div class="pub-q"><p class="sub-h">Questions from the review</p><ul>${p.questions.map(x => `<li>${md(x)}</li>`).join('')}</ul><p class="dim">Answer them in your head or send it back; they do not block Publish.</p></div>` : '';
  const busy = S.ui.busy && S.ui.busy['pub:' + it.folder];
  return `<div class="pub"><p class="sub-h">Ready to publish</p>${uiHtml(it, p)}${q}` +
    `<div class="row"><button type="button" class="btn primary" data-publish="${h(it.folder)}"${busy ? ' disabled' : ''} title="Pushes every branch in pr.md (never force), then opens each PR page with the text filled in">${busy ? 'Publishing…' : 'Publish ' + outsideMark('git')}</button>` +
    `<span class="dim">Pushes ${h(String((it.pr || []).length))} branch${(it.pr || []).length === 1 ? '' : 'es'} and opens the PRs.</span></div></div>`;
}

/** Publish all ready, for the Ready lane: only when at least one build has nothing to answer. */
export function publishAllHtml(items) {
  const n = readyCleanCount(items);
  if (!n) return '';
  const busy = S.ui.busy && S.ui.busy['pub:all'];
  return `<button type="button" class="btn primary small ln-puball" data-publish-all="1"${busy ? ' disabled' : ''} title="Publishes every ready build whose review has no questions and whose UI checks passed">${busy ? 'Publishing…' : `Publish all ready (${n})`}</button>`;
}

/** The confirm text for Publish: each repo and branch. */
export function publishItems(it) {
  return (it.pr || []).map(r => `${r.repo}: ${r.branch || '?'} → ${r.target || 'main'}`);
}

// ------------------------------------------------------------------ Overlap
/** Other active runs that change the same files as this one: [{ with, files, it }]. */
export function overlapsOf(it) {
  const o = it && S.D && S.D.overlaps && S.D.overlaps[it.folder];
  return Array.isArray(o) ? o.map(x => ({ ...x, it: itemForFolder(x.with) })).filter(x => x.it) : [];
}

/** At approval: the note and a Build after button for each overlapping run. */
export function overlapHtml(it) {
  const n = it && it.next;
  if (!n || !n.command || !/^\/approve\b/.test(n.command)) return '';
  const list = overlapsOf(it);
  if (!list.length) return '';
  return `<div class="pub-over"><p><span class="flag warn">Same files as another build</span></p><ul>${list.map(o => {
    const name = (o.it.id ? '#' + o.it.id + ' ' : '') + (o.it.title || o.with);
    return `<li>${h(name)}: ${o.files.slice(0, 3).map(f => `<code>${h(f)}</code>`).join(', ')}${o.files.length > 3 ? ` and ${o.files.length - 3} more` : ''}` +
      ` <button type="button" class="btn small" data-auto-after="${h(it.folder)}" data-after="${h(o.with)}" title="Approves the plan now and builds it once ${h(name)} has its PR text, so the two do not conflict">Approve, build after it</button></li>`;
  }).join('')}</ul><p class="dim">Or approve as usual to build now; the PR catches up with main before it is written.</p></div>`;
}
