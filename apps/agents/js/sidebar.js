/* Dispatch: the left sidebar (Dispatch App Experience Plan, phase 1, P2), as HTML strings from S.
   Start work, Pinned, All runs and Needs you, Pull requests (To review: teammates' PRs; My PRs: your
   runs' PRs), and Projects (with folders), each project expandable to its
   recent runs with a status dot. Picking an entry sets S.ui.scope, which filters the main list (view.js).
   Projects and which run is in which come from the opencode connector (`state.projects`, lib/projects.mjs);
   folders and pins come from this browser (local.js, S.local). With an older connector that has no
   projects, every run is in Inbox and the project controls are hidden. */
import { S } from './state.js';
import { h, bucketOf, itemSession, isBusy, autoIs, itemKey, plural, ICON } from './view.js';
import { isPinned } from './local.js';
import { toReviewCount, reviewsAsking, mineNeedsCount, mineItems } from './pr-reviews.js';

export const INBOX = 'inbox';
export const projectsOn = () => !!(S.D && S.D.projects && Array.isArray(S.D.projects.projects));
const INBOX_ROW = { id: INBOX, name: 'Inbox', color: 'slate', builtIn: true };
export function projectList() { return projectsOn() ? S.D.projects.projects : [INBOX_ROW]; }
export function projectById(id) { return projectList().find(p => p.id === id) || null; }
export function projectOf(it) { return (projectsOn() && S.D.projects.runs[it.folder]) || INBOX; }
export const colors = () => (projectsOn() && S.D.projects.colors) || ['slate'];
// Runs: everything in .work but PR reviews, which have their own page (pr-reviews.js).
const items = () => ((S.D && S.D.items) || []).filter(it => it.kind !== 'pr');
const newest = list => list.slice().sort((a, b) => (b.modifiedMs || 0) - (a.modifiedMs || 0));

// ------------------------------------------------------------------ run status
// One word per run for its sidebar dot: what an engineer needs to know at a glance.
export const STATUS = {
  running: 'Running', review: 'Needs review', revising: 'Revising', failed: 'Failed', done: 'Ready to ship', paused: 'Paused', idle: 'Up next'
};
export function runStatus(it) {
  const s = itemSession(it);
  const busy = isBusy(s) || autoIs(it, 'running');
  if (bucketOf(it) === 'needs') return 'review';
  if (it.blocked || (s && s.error && !busy)) return 'failed';
  if (busy) return it.stage === 'build' && (it.files || []).includes('review.md') ? 'revising' : 'running';
  if (it.bucket === 'ship') return 'done';
  if (it.bucket === 'paused') return 'paused';
  return 'idle';
}
export const needsReview = () => newest(items().filter(it => bucketOf(it) === 'needs'));
export const runsIn = pid => newest(items().filter(it => projectOf(it) === pid));
export function runLabel(it) { return it.id ? '#' + it.id + ' ' + it.title : it.title; }

// ------------------------------------------------------------------ scope
// S.ui.scope: {kind: 'all'} | {kind: 'needs'} | {kind: 'reviews'} (To review) | {kind: 'mine'} (My PRs) | {kind: 'project', id}.
export function scope() {
  const sc = S.ui.scope || { kind: 'all' };
  if (sc.kind === 'project' && !projectById(sc.id)) return { kind: 'all' };
  return sc;
}
export function inScope(it) {
  const sc = scope();
  if (it.kind === 'pr' || sc.kind === 'reviews') return sc.kind === 'reviews' && it.kind === 'pr';
  if (sc.kind === 'mine') return mineItems().includes(it);
  if (sc.kind === 'needs') return bucketOf(it) === 'needs';
  if (sc.kind === 'project') return projectOf(it) === sc.id;
  return true;
}
/** The project a new run should go in: the one in view, else Inbox. */
export function scopeProject() { const sc = scope(); return sc.kind === 'project' ? sc.id : INBOX; }

// ------------------------------------------------------------------ pieces
const PIN = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M10 2.5l3.5 3.5-2.2.9-2.6 2.6.3 3-1.5 1.5-2.4-2.4L2.5 14l.4-2.6L.5 9l1.5-1.5 3 .3 2.6-2.6z" transform="translate(1 -.5)"/></svg>';
const CHEV = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5"/></svg>';
const GEAR = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/></svg>';
const sw = c => `<span class="sw" data-c="${h(c)}" aria-hidden="true"></span>`;
const dot = st => `<span class="sd ${st}" aria-hidden="true"></span>`;
const badge = n => (n ? `<span class="cnt">${n}</span>` : '');
const on = (kind, id) => { const sc = scope(); return sc.kind === kind && (kind !== 'project' || sc.id === id); };

function runRow(it, pinned) {
  const st = runStatus(it);
  const pin = S.local && isPinned(S.local, 'run', it.folder);
  return `<li class="srun"><button type="button" class="srow" data-side-run="${h(it.folder)}" title="${h(runLabel(it) + ': ' + STATUS[st])}">${dot(st)}` +
    `<span class="sl">${it.id ? `<span class="num">#${h(it.id)}</span>` : ''}${h(it.title)}</span>` +
    (pinned ? `<span class="sp">${h((projectById(projectOf(it)) || INBOX_ROW).name)}</span>` : '') + '</button>' +
    `<button type="button" class="spin-btn${pin ? ' on' : ''}" data-pin="run" data-pin-id="${h(it.folder)}" aria-pressed="${!!pin}" aria-label="${pin ? 'Unpin' : 'Pin'} ${h(runLabel(it))}" title="${pin ? 'Unpin' : 'Pin'}">${PIN}</button></li>`;
}

const RUNS_SHOWN = 6;
function projectRow(p) {
  const runs = runsIn(p.id);
  const open = !(S.local && S.local.closed[p.id]);
  const waiting = runs.filter(it => bucketOf(it) === 'needs').length;
  const pin = S.local && isPinned(S.local, 'project', p.id);
  const head = `<div class="sproj${on('project', p.id) ? ' on' : ''}">` +
    `<button type="button" class="tw${open ? ' open' : ''}" data-side-toggle="${h(p.id)}" aria-expanded="${open}" aria-label="${open ? 'Collapse' : 'Expand'} ${h(p.name)}">${CHEV}</button>` +
    `<button type="button" class="srow" data-side-scope="project" data-side-id="${h(p.id)}">${sw(p.color)}<span class="sl">${h(p.name)}</span>` +
    (waiting ? `<span class="cnt gate" title="${plural(waiting, 'run')} need you">${waiting}</span>` : `<span class="n">${runs.length || ''}</span>`) + '</button>' +
    (projectsOn() && !p.builtIn ? `<button type="button" class="sact" data-proj-edit="${h(p.id)}" aria-label="Edit ${h(p.name)}" title="Edit project">${GEAR}</button>` : '') +
    (p.builtIn ? '' : `<button type="button" class="spin-btn${pin ? ' on' : ''}" data-pin="project" data-pin-id="${h(p.id)}" aria-pressed="${!!pin}" aria-label="${pin ? 'Unpin' : 'Pin'} ${h(p.name)}" title="${pin ? 'Unpin' : 'Pin'}">${PIN}</button>`) +
    '</div>';
  if (!open) return `<li>${head}</li>`;
  const shown = runs.slice(0, RUNS_SHOWN);
  const more = runs.length > RUNS_SHOWN ? `<li><button type="button" class="srow more" data-side-scope="project" data-side-id="${h(p.id)}">${plural(runs.length - RUNS_SHOWN, 'more run')}</button></li>` : '';
  const empty = runs.length ? '' : `<li class="sempty">${p.builtIn ? 'Runs started with no project land here.' : 'No runs yet.'}</li>`;
  return `<li>${head}<ul class="sruns">${shown.map(it => runRow(it, false)).join('')}${more}${empty}</ul></li>`;
}

function projectsSection() {
  const list = projectList();
  const loc = S.local || { folders: [], placement: {}, closed: {} };
  const top = list.filter(p => !loc.placement[p.id]);
  let out = top.map(projectRow).join('');
  for (const f of loc.folders) {
    const inside = list.filter(p => loc.placement[p.id] === f.id);
    const open = !loc.closed[f.id];
    out += `<li class="sfolder"><div class="sfh"><button type="button" class="tw${open ? ' open' : ''}" data-side-toggle="${h(f.id)}" aria-expanded="${open}" aria-label="${open ? 'Collapse' : 'Expand'} ${h(f.name)}">${CHEV}</button>` +
      `<span class="sl">${h(f.name)}</span><span class="n">${inside.length || ''}</span>` +
      `<button type="button" class="sact" data-folder-edit="${h(f.id)}" aria-label="Edit folder ${h(f.name)}" title="Rename or remove">${GEAR}</button></div>` +
      (open ? `<ul class="sprojs">${inside.map(projectRow).join('') || '<li class="sempty">Empty. Put a project here from its settings.</li>'}</ul>` : '') + '</li>';
  }
  const acts = projectsOn()
    ? '<span class="sh-acts"><button type="button" class="lnk plain" data-proj-new="1">New project</button><button type="button" class="lnk plain" data-folder-new="1">New folder</button></span>'
    : '';
  return `<section class="sgroup" aria-labelledby="sh-proj"><h3 id="sh-proj">Projects${acts}</h3><ul class="sprojs">${out}</ul>` +
    (projectsOn() ? '' : '<p class="snote">Update Workshop to group runs into projects.</p>') + '</section>';
}

function pinnedSection() {
  const pins = (S.local && S.local.pins) || [];
  const rows = pins.map(p => {
    if (p.kind === 'project') {
      const pr = projectById(p.id);
      return pr ? `<li><div class="sproj${on('project', pr.id) ? ' on' : ''}"><span class="tw-gap"></span><button type="button" class="srow" data-side-scope="project" data-side-id="${h(pr.id)}">${sw(pr.color)}<span class="sl">${h(pr.name)}</span></button>` +
        `<button type="button" class="spin-btn on" data-pin="project" data-pin-id="${h(pr.id)}" aria-pressed="true" aria-label="Unpin ${h(pr.name)}" title="Unpin">${PIN}</button></div></li>` : '';
    }
    const it = items().find(x => x.folder === p.id);
    return it ? runRow(it, true) : '';
  }).join('');
  if (!rows) return '';
  return `<section class="sgroup" aria-labelledby="sh-pin"><h3 id="sh-pin">Pinned</h3><ul class="sruns flat">${rows}</ul></section>`;
}

// PR reviews: an agent waiting for you (gate color), else PRs waiting on you with no review yet.
function reviewBadge() {
  const ask = reviewsAsking();
  if (ask) return `<span class="cnt gate" title="The reviewer is waiting for you">${ask}</span>`;
  const n = toReviewCount();
  return n ? `<span class="cnt" title="${plural(n, 'PR')} waiting on you with no review yet">${n}</span>` : '';
}

/** The sidebar. open: shown as a drawer on narrow screens. */
export function sidebarHtml() {
  const needs = needsReview().length + reviewsAsking();
  const all = items().length;
  const nav = '<ul class="snav">' +
    `<li><button type="button" class="srow${on('all') ? ' on' : ''}" data-side-scope="all"><span class="sl">All runs</span><span class="n">${all || ''}</span></button></li>` +
    `<li><button type="button" class="srow needs${on('needs') ? ' on' : ''}" data-side-scope="needs"><span class="sl">Needs you</span>${badge(needs)}</button></li></ul>`;
  const mineN = mineNeedsCount();
  const prs = '<section class="sgroup" aria-labelledby="sh-prs"><h3 id="sh-prs">Pull requests</h3><ul class="snav">' +
    `<li><button type="button" class="srow prs${on('reviews') ? ' on' : ''}" data-side-scope="reviews" title="Teammates' pull requests and their first-pass reviews"><span class="sl">To review</span>${reviewBadge()}</button></li>` +
    `<li><button type="button" class="srow mine${on('mine') ? ' on' : ''}" data-side-scope="mine" title="Pull requests from your runs"><span class="sl">My PRs</span>` +
    (mineN ? `<span class="cnt" title="${plural(mineN, 'run')} with a code review to do">${mineN}</span>` : `<span class="n">${mineItems().length || ''}</span>`) + '</button></li></ul></section>';
  return `<nav class="side${S.ui.side ? ' open' : ''}" aria-label="Runs and projects">` +
    `<div class="side-top"><button type="button" class="btn primary new-run" data-start-open="1" title="Start a run in ${h((projectById(scopeProject()) || INBOX_ROW).name)}">Start work</button>` +
    `<button type="button" class="ibtn side-close" data-side-close="1" aria-label="Close the sidebar">${ICON.x}</button></div>` +
    pinnedSection() + nav + prs + projectsSection() + '</nav>' +
    (S.ui.side ? '<div class="side-scrim" data-side-close="1"></div>' : '');
}

/** The line above the list when a project or Needs you is in view. */
export function scopeHeadHtml() {
  const sc = scope();
  if (sc.kind === 'all' || sc.kind === 'reviews' || sc.kind === 'mine') return '';
  if (sc.kind === 'needs') {
    const n = needsReview().length, r = reviewsAsking();
    const what = [n ? plural(n, 'run') : '', r ? plural(r, 'PR review') : ''].filter(Boolean).join(' and ');
    return `<div class="scope-head"><h2>Needs you</h2><span class="dim">${what ? what + ' waiting on you, across all projects' : 'Nothing is waiting on you.'}</span>` +
      '<button type="button" class="lnk plain" data-side-scope="all">Show all runs</button></div>';
  }
  const p = projectById(sc.id);
  const n = runsIn(sc.id).length;
  const meta = [plural(n, 'run')];
  if (p.repo) meta.push(`<span class="mono">${h(p.repo)}</span>`);
  if (p.baseBranch) meta.push(`from <span class="mono">${h(p.baseBranch)}</span>`);
  return `<div class="scope-head">${sw(p.color)}<h2>${h(p.name)}</h2><span class="dim">${meta.join(' · ')}</span>` +
    (projectsOn() && !p.builtIn ? `<button type="button" class="btn" data-proj-edit="${h(p.id)}">Edit project</button>` : '') +
    '<button type="button" class="lnk plain" data-side-scope="all">Show all runs</button></div>';
}

/** A small button on each run card: the project it is in. Opens the move sheet. */
export function projectChip(it) {
  if (!projectsOn()) return '';
  const p = projectById(projectOf(it)) || INBOX_ROW;
  return `<button type="button" class="pchip" data-move="${h(it.folder)}" title="In ${h(p.name)}. Move to another project.">${sw(p.color)}${h(p.name)}</button>`;
}

// ------------------------------------------------------------------ sheets
const sheet = (id, title, body, foot) =>
  `<div class="modal" data-sheet="1"><div class="backdrop" data-close-sheet="1"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="${id}">` +
  `<div class="sheet-head"><h3 id="${id}">${title}</h3><button type="button" class="ibtn" data-close-sheet="1" aria-label="Close">${ICON.x}</button></div>${body}<footer>${foot}</footer></div></div>`;
const err = e => (e ? `<p class="gmsg bad" role="status">${h(e)}</p>` : '');

/**
 * The fields a project sheet saves, from what was typed (S.ui.drafts["proj:<field>"]) over the project's
 * current values. Returns {args} or {error}. On an edit only changed fields are sent.
 */
export function projectArgs(st, drafts, current) {
  const d = k => (drafts['proj:' + k] === undefined ? undefined : String(drafts['proj:' + k]));
  const name = (d('name') ?? (current ? current.name : '')).trim();
  if (!name) return { error: 'Give the project a name.' };
  if (name.length > 80) return { error: 'Keep the name under 80 characters.' };
  const fields = { name, color: st.color, repo: (d('repo') ?? (current && current.repo) ?? '').trim(), baseBranch: (d('baseBranch') ?? (current && current.baseBranch) ?? '').trim(), instructions: d('instructions') ?? (current ? current.instructions : '') };
  if (fields.baseBranch && !/^[A-Za-z0-9._/-]+$/.test(fields.baseBranch)) return { error: 'A branch name has letters, numbers, dots, dashes, underscores and slashes only.' };
  if (!current) {
    const args = { name };
    for (const k of ['color', 'repo', 'baseBranch', 'instructions']) if (fields[k]) args[k] = fields[k];
    return { args };
  }
  const args = { id: current.id };
  for (const k of ['name', 'color', 'repo', 'baseBranch', 'instructions']) if ((fields[k] || '') !== (current[k] || '')) args[k] = fields[k];
  return { args };
}

export function projectSheetHtml() {
  const st = S.ui.project;
  const cur = st.id ? projectById(st.id) : null;
  if (st.id && !cur) { S.ui.project = null; return ''; }
  const v = (k, dflt) => h(S.ui.drafts['proj:' + k] !== undefined ? S.ui.drafts['proj:' + k] : dflt == null ? '' : dflt);
  const repos = ((S.D && S.D.repos) || []).map(r => r.folder);
  const repoNow = S.ui.drafts['proj:repo'] !== undefined ? S.ui.drafts['proj:repo'] : (cur && cur.repo) || '';
  const repoOpts = ['<option value="">None yet</option>'].concat(repos.map(r => `<option value="${h(r)}"${r === repoNow ? ' selected' : ''}>${h(r)}</option>`));
  if (repoNow && !repos.includes(repoNow)) repoOpts.push(`<option value="${h(repoNow)}" selected>${h(repoNow)} (not found)</option>`);
  const folders = (S.local && S.local.folders) || [];
  const fNow = st.folder !== undefined ? st.folder : (cur && S.local && S.local.placement[cur.id]) || '';
  const color = st.color || (cur && cur.color) || colors()[0];
  const swatches = colors().map(c => `<button type="button" class="swb${c === color ? ' on' : ''}" data-proj-color="${h(c)}" aria-pressed="${c === color}" aria-label="${h(c)}" title="${h(c)}">${sw(c)}</button>`).join('');
  const body = `<p>A project groups runs. Runs started in it get its instructions.</p>` +
    '<form class="cfg" data-proj-form="1" novalidate>' +
    `<label class="cfg-row"><span class="cfg-t">Name</span><input type="text" class="proj-first" data-draft="proj:name" value="${v('name', cur && cur.name)}" maxlength="80" autocomplete="off" placeholder="Orders API"></label>` +
    `<div class="cfg-row"><span class="cfg-t">Color</span><div class="swatches" role="group" aria-label="Color">${swatches}</div></div>` +
    `<label class="cfg-row"><span class="cfg-t">Repo</span><span class="cfg-d">One repo per project for now. Add repos from the Repos panel.</span><select data-draft="proj:repo">${repoOpts.join('')}</select></label>` +
    `<label class="cfg-row"><span class="cfg-t">Base branch (optional)</span><input type="text" class="mono" data-draft="proj:baseBranch" value="${v('baseBranch', cur && cur.baseBranch)}" placeholder="main" spellcheck="false" autocomplete="off"></label>` +
    `<label class="cfg-row"><span class="cfg-t">Instructions for the agent (optional)</span><span class="cfg-d">Added to every run started in this project, like a repo's AGENTS.md.</span><textarea rows="5" data-draft="proj:instructions" placeholder="Run npm test before every commit. Keep PRs under 400 lines.">${v('instructions', cur && cur.instructions)}</textarea></label>` +
    (folders.length ? `<label class="cfg-row"><span class="cfg-t">Folder in the sidebar</span><span class="cfg-d">Only in this browser.</span><select data-proj-folder="1"><option value="">None</option>${folders.map(f => `<option value="${h(f.id)}"${f.id === fNow ? ' selected' : ''}>${h(f.name)}</option>`).join('')}</select></label>` : '') +
    '</form>' + err(st.error);
  const del = cur ? (st.confirmDelete
    ? `<button type="button" class="btn destroy" data-proj-delete="${h(cur.id)}"${st.busy ? ' disabled' : ''}>Remove, move ${plural(runsIn(cur.id).length, 'run')} to Inbox</button>`
    : `<button type="button" class="btn remove" data-proj-delete-ask="1">Remove project</button>`) : '';
  const foot = del + '<span class="grow"></span><button type="button" class="btn" data-close-sheet="1">Cancel</button>' +
    `<button type="button" class="btn primary" data-proj-save="1"${st.busy ? ' disabled' : ''}>${st.busy ? 'Saving' : cur ? 'Save' : 'Add project'}</button>`;
  return sheet('proj-h', cur ? 'Edit ' + h(cur.name) : 'New project', body, foot);
}

export function folderSheetHtml() {
  const st = S.ui.folder;
  const cur = st.id ? ((S.local && S.local.folders) || []).find(f => f.id === st.id) : null;
  if (st.id && !cur) { S.ui.folder = null; return ''; }
  const val = S.ui.drafts['folder:name'] !== undefined ? S.ui.drafts['folder:name'] : cur ? cur.name : '';
  const body = '<p>Folders group projects in the sidebar. Saved in this browser only.</p>' +
    `<form class="cfg" data-folder-form="1" novalidate><label class="cfg-row"><span class="cfg-t">Name</span><input type="text" class="folder-first" data-draft="folder:name" value="${h(val)}" maxlength="60" autocomplete="off" placeholder="Platform"></label></form>` + err(st.error);
  const foot = (cur ? `<button type="button" class="btn remove" data-folder-delete="${h(cur.id)}" title="Its projects move to the top level">Remove folder</button>` : '') +
    '<span class="grow"></span><button type="button" class="btn" data-close-sheet="1">Cancel</button>' +
    `<button type="button" class="btn primary" data-folder-save="1">${cur ? 'Save' : 'Add folder'}</button>`;
  return sheet('folder-h', cur ? 'Folder' : 'New folder', body, foot);
}

export function moveSheetHtml() {
  const st = S.ui.move;
  const it = items().find(x => x.folder === st.folder);
  if (!it) { S.ui.move = null; return ''; }
  const now = projectOf(it);
  const rows = projectList().map(p => `<li><button type="button" class="srow mv${p.id === now ? ' on' : ''}" data-move-to="${h(p.id)}"${p.id === now || st.busy ? ' disabled' : ''}>${sw(p.color)}<span class="sl">${h(p.name)}</span>${p.id === now ? '<span class="dim">Here now</span>' : ''}</button></li>`).join('');
  const body = `<p>Only the listing changes. The work item, branches and sessions stay as they are.</p><ul class="mvlist">${rows}</ul>` + err(st.error);
  return sheet('move-h', 'Move ' + h(runLabel(it)), body, '<span class="grow"></span><button type="button" class="btn" data-close-sheet="1">Close</button>');
}
