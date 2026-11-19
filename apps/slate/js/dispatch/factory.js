/* The software factory in Loom (Loom 6.2.0, opencode connector 1.21.0; plan: claude/software-factory-v1-plan.md in
   the Workshop project). You touch a build twice: approve the plan, then publish the PR.
   - Publish (Gate 2): on a ready build, what came out (UI checks, review questions) and one Publish button that pushes
     every branch and opens the PRs. Publish all ready does it for every build with nothing to answer.
   - Teach: knowledge gaps Tandem logged instead of asking (state.gaps). One answer each; /teach writes it where it
     belongs and builds waiting on it carry on.
   - Overlap: at approval, a build that changes the same files as another offers Build after that one.
   No DOM: main.js paints what these return and handles the clicks. */
import { S } from './state.js';
import { h, md, itemForFolder, reviewHref } from './view.js';
import { hasDraft } from './review-state.js';
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

const store = (() => { try { return window.localStorage; } catch (e) { return null; } })();
/** Draft code review comments not sent yet for this item, in this browser (Publish all ready leaves those out). */
export const hasDrafts = it => !!(store && it && it.id && hasDraft(store, it.id));

/** Ready to publish with nothing to answer and no failed UI check: what Publish all ready would send. Since connector
 *  1.27.0 also nothing waiting on Tandem from a Send back, no must fix comment it declined, and no unsent draft. */
export function readyClean(it) {
  const p = publishOf(it);
  return !!p && p.ready && !p.published && !p.questions.length && !p.ui.some(u => u.name !== 'before' && u.verdict === 'fail') && !(p.tests || []).some(t => t.name !== 'before' && t.verdict === 'fail') &&
    !p.revising && !p.openMustFix && !hasDrafts(it);
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
/** The regression suite on the Publish block (eng-agents Core 4.14.0): counts, the new tests and the criteria they
    cover, and any failures. The latest run after the change wins (after, or pr). */
export function testsHtml(p) {
  const runs = (p && p.tests || []).filter(t => t.name !== 'before');
  if (!runs.length) return '';
  const t = runs[runs.length - 1];
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (t.verdict === 'skipped') return `<div class="pub-tests"><p><span class="flag warn">Regression tests skipped</span>${t.reason ? ' ' + h(t.reason) : ''}</p></div>`;
  const bits = [`${t.passed} passed`];
  if (t.newTests.length) bits.push(`${plural(t.newTests.length, 'new test')}${t.acceptance.length ? ' covering ' + t.acceptance.join(', ') : ''}`);
  if (t.flaky) bits.push(`${t.flaky} flaky`);
  if (t.preExisting.length) bits.push(`${t.preExisting.length} failing before this change`);
  const [cls, word] = t.verdict === 'fail' ? ['bad', `${plural(t.failed, 'test')} failing`] : ['ok', 'Regression tests passed'];
  const list = (rows, label) => rows.length ? `<p class="dim">${h(label)}</p><ul class="gone">${rows.map(x => `<li>${h(x.title)} <span class="dim">${h(x.file)}</span>${x.error ? `<br><span class="dim">${h(x.error)}</span>` : ''}</li>`).join('')}</ul>` : '';
  return `<div class="pub-tests"><p><span class="flag ${cls}">${h(word)}</span> ${h(bits.join(', '))}.</p>${list(t.failures, 'Failing')}${list(t.flakyTests, 'Flaky (passed on a retry)')}</div>`;
}

function shotImgs(it, before, after, diff) {
  const src = f => (S.ui.shots || {})[`${it.folder}|${f}`];
  const one = (f, label) => !f ? '' : src(f) ? `<figure><img src="${h(src(f))}" alt="${h(label)}" loading="lazy"><figcaption>${h(label)}</figcaption></figure>` : `<figure class="dim">Loading ${h(label.toLowerCase())}</figure>`;
  return `<div class="pub-imgs">${one(before, 'Before')}${one(after, 'After')}${one(diff, 'What changed')}</div>`;
}

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
/** The code, per repo (connector 1.27.0): how big the change is, where its code review stands, and Review the code. */
function codeHtml(it, p) {
  const rows = (it.pr || []).map(r => {
    const d = (p.diff || []).find(x => x.repo === r.repo);
    const rv = (p.review || {})[r.repo] || null;
    const size = d && d.files != null ? `${plural(d.files, 'file')}, <span class="add">+${h(String(d.additions))}</span> <span class="del">-${h(String(d.deletions))}</span>` : '<span class="dim">counting the change…</span>';
    const rev = rv && rv.revision > 1 ? ` <span class="dim">revision ${h(String(rv.revision))}</span>` : '';
    const link = S.conn === 'on' ? `<a class="btn small" href="${h(reviewHref(it, r.repo))}" data-review title="Read the diff with Tandem's notes, comment on lines, then approve and publish or send it back">Review the code</a>` : '';
    return `<li><span class="mono">${h(r.repo)}</span> ${size}${rev}${link}</li>`;
  });
  if (!rows.length) return '';
  const drafts = hasDrafts(it) ? '<p class="dim">You have draft comments in the code review that are not sent yet.</p>' : '';
  const mf = p.openMustFix ? `<p class="flag warn">Tandem declined ${plural(p.openMustFix, 'must fix comment')}. Read its answers in the code review before you publish.</p>` : '';
  return `<div class="pub-code"><p class="sub-h">The code</p><ul class="pub-repos">${rows.join('')}</ul>${mf}${drafts}<p class="dim">Optional: Publish works without opening it.</p></div>`;
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
  return `<div class="pub"><p class="sub-h">Ready to publish</p>${testsHtml(p)}${uiHtml(it, p)}${q}${codeHtml(it, p)}` +
    `<div class="row"><button type="button" class="btn primary" data-publish="${h(it.folder)}"${busy ? ' disabled' : ''} title="Pushes every branch in pr.md (never force), then opens each PR page with the text filled in">${busy ? 'Publishing…' : 'Publish ' + outsideMark('git')}</button>` +
    `<span class="dim">Pushes ${h(String((it.pr || []).length))} branch${(it.pr || []).length === 1 ? '' : 'es'} and opens the PRs.</span></div></div>`;
}

/** Publish all ready, for the Ready lane: only when at least one build has nothing to answer. */
export function publishAllHtml(items) {
  const n = readyCleanCount(items);
  if (!n) return '';
  const busy = S.ui.busy && S.ui.busy['pub:all'];
  return `<button type="button" class="btn primary small ln-puball" data-publish-all="1"${busy ? ' disabled' : ''} title="Publishes every ready build whose review has no questions, whose tests and UI checks passed, and that has no code review comments waiting">${busy ? 'Publishing…' : `Publish all ready (${n})`}</button>`;
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

// ------------------------------------------------------------------ ADO links (Loom 6.3.0)
// Tandem's items are the source; ADO is an optional link per item (claude/work-items-source-v1-plan.md). The link
// is one line in workitem.md, written by the connector (item.link, item.unlink).
/** A run's link: { linked, ado, was } from state.adoLinks, or null for runs that are not work items. */
export const adoLinkOf = it => (it && S.D && S.D.adoLinks && S.D.adoLinks[it.folder]) || null;

/** The link row in a run's panel: linked (with Unlink) or local (with Link to ADO and Create in ADO). */
export function adoLinkHtml(it, adoReady) {
  const l = adoLinkOf(it);
  if (!l) return '';
  const busy = S.ui.busy && S.ui.busy['link:' + it.folder] ? ' disabled' : '';
  if (l.linked) {
    return `<div class="ln-link"><span class="ln-ado" title="Commits and PRs get AB#${h(l.ado)}; Done offers Resolve in ADO">ADO #${h(l.ado)}</span>` +
      `<button type="button" class="lnk plain" data-ado-unlink="${h(it.folder)}"${busy} title="Keep it local: nothing goes to ADO for it">Unlink</button></div>`;
  }
  const open = !!S.ui.open['adolink:' + it.folder];
  const form = open ? `<span class="ln-linkform"><input type="text" inputmode="numeric" data-draft="adolink:${h(it.folder)}" value="${h(S.ui.drafts['adolink:' + it.folder] || l.was || '')}" placeholder="ADO number" aria-label="ADO work item number">` +
    `<button type="button" class="btn small" data-ado-link="${h(it.folder)}" data-was="${h(l.was || '')}"${busy}>Link</button>` +
    (adoReady ? `<button type="button" class="btn small ghost" data-ado-create="${h(it.folder)}"${busy} title="Creates one work item in ADO with this title, then links it">Create in ADO ${outsideMark('ado')}</button>` : '') + '</span>' : '';
  return `<div class="ln-link"><span class="dim" title="Nothing goes to ADO for this build">Local${l.was ? ` (was ADO #${h(l.was)})` : ''}</span>` +
    `<button type="button" class="lnk plain" data-ado-link-toggle="${h(it.folder)}" aria-expanded="${open}">Link to ADO</button>${form}</div>`;
}

/** The one-time notice after every numbered item was made local (connector 1.22.0). */
export function adoNoticeHtml() {
  const n = S.D && S.D.adoNotice;
  if (!n || !n.count) return '';
  return `<div class="banner ln-notice"><p>${h(String(n.count))} build${n.count === 1 ? ' is' : 's are'} now local: Workshop no longer updates ADO for ${n.count === 1 ? 'it' : 'them'}. Relink any that matter from its panel (Link to ADO).</p><button type="button" class="btn small" data-ado-notice="1">Got it</button></div>`;
}
