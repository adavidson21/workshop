/* Dispatch: projects, as HTML strings from S. A project groups runs (the opencode connector's `state.projects`,
   lib/projects.mjs; project.create, project.update, project.delete, run.assign). Runs with no project are in the
   built-in Inbox project. In Dispatch 2.0 projects are a filter on the Runs and Ship tabs (S.view.project, kept in
   this browser by local.js), plus a chip on each run and a list in the overflow menu. With an older connector that
   has no projects, every run is in Inbox and the project controls are hidden. */
import { S } from './state.js';
import { h, bucketOf, itemSession, isBusy, autoIs, plural, ICON } from './view.js';

export const INBOX = 'inbox';
export const projectsOn = () => !!(S.D && S.D.projects && Array.isArray(S.D.projects.projects));
const INBOX_ROW = { id: INBOX, name: 'Inbox', color: 'slate', builtIn: true };
export function projectList() { return projectsOn() ? S.D.projects.projects : [INBOX_ROW]; }
export function projectById(id) { return projectList().find(p => p.id === id) || null; }
export function projectOf(it) { return (projectsOn() && S.D.projects.runs[it.folder]) || INBOX; }
/** Shown name: the built-in project (runs with no project) reads "No project", so it is not confused with the Inbox tab. */
export const projectName = p => (p.builtIn ? 'No project' : p.name);
/** Projects the person made (not just the built-in one): only then do chips and the filter show. */
export const hasProjects = () => projectsOn() && projectList().some(p => !p.builtIn);
export const colors = () => (projectsOn() && S.D.projects.colors) || ['slate'];
// Runs: everything in .work but PR reviews, which have their own tab (pr-reviews.js).
const items = () => ((S.D && S.D.items) || []).filter(it => it.kind !== 'pr');
const newest = list => list.slice().sort((a, b) => (b.modifiedMs || 0) - (a.modifiedMs || 0));

// ------------------------------------------------------------------ run status
// One word per run for its status dot: what an engineer needs to know at a glance.
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

// ------------------------------------------------------------------ the filter
/** The project filter in effect: "all", or a project that still exists. */
export function projectFilter() {
  const p = (S.view && S.view.project) || 'all';
  return p !== 'all' && projectsOn() && projectById(p) ? p : 'all';
}
export function inProject(it) { const p = projectFilter(); return p === 'all' || projectOf(it) === p; }
/** The project a new run should go in: the one filtered to, else Inbox. */
export function startProject() { const p = projectFilter(); return p === 'all' ? INBOX : p; }

/** Chips above a list: All, then each project with how many of `list` are in it. Hidden without projects. */
export function projectFilterHtml(list) {
  if (!hasProjects()) return '';
  const cur = projectFilter();
  const n = pid => list.filter(it => projectOf(it) === pid).length;
  const chip = (id, label, count, color) => `<button type="button" class="fchip${cur === id ? ' on' : ''}" data-filter-project="${h(id)}" aria-pressed="${cur === id}">` +
    (color ? sw(color) : '') + `<span>${h(label)}</span><span class="n">${count}</span></button>`;
  const chips = [chip('all', 'All projects', list.length)].concat(projectList().filter(p => !p.builtIn || n(p.id)).map(p => chip(p.id, projectName(p), n(p.id), p.color)));
  return `<div class="filters" role="group" aria-label="Project">${chips.join('')}</div>`;
}

// ------------------------------------------------------------------ pieces
export const sw = c => `<span class="sw" data-c="${h(c)}" aria-hidden="true"></span>`;
export const statusDot = st => `<span class="sd ${st}" aria-hidden="true" title="${h(STATUS[st] || '')}"></span>`;

/** A small button on each run: the project it is in. Opens the move sheet. */
export function projectChip(it) {
  if (!hasProjects()) return '';
  const p = projectById(projectOf(it)) || INBOX_ROW;
  return `<button type="button" class="pchip${p.builtIn ? ' none' : ''}" data-move="${h(it.folder)}" title="${p.builtIn ? 'In no project' : 'In ' + h(p.name)}. Move to a project.">${sw(p.color)}${h(projectName(p))}</button>`;
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
  const color = st.color || (cur && cur.color) || colors()[0];
  const swatches = colors().map(c => `<button type="button" class="swb${c === color ? ' on' : ''}" data-proj-color="${h(c)}" aria-pressed="${c === color}" aria-label="${h(c)}" title="${h(c)}">${sw(c)}</button>`).join('');
  const body = `<p>A project groups runs. Runs started in it get its instructions.</p>` +
    '<form class="cfg" data-proj-form="1" novalidate>' +
    `<label class="cfg-row"><span class="cfg-t">Name</span><input type="text" class="proj-first" data-draft="proj:name" value="${v('name', cur && cur.name)}" maxlength="80" autocomplete="off" placeholder="Orders API"></label>` +
    `<div class="cfg-row"><span class="cfg-t">Color</span><div class="swatches" role="group" aria-label="Color">${swatches}</div></div>` +
    `<label class="cfg-row"><span class="cfg-t">Repo</span><span class="cfg-d">One repo per project for now. Add repos from Repos in the menu.</span><select data-draft="proj:repo">${repoOpts.join('')}</select></label>` +
    `<label class="cfg-row"><span class="cfg-t">Base branch (optional)</span><input type="text" class="mono" data-draft="proj:baseBranch" value="${v('baseBranch', cur && cur.baseBranch)}" placeholder="main" spellcheck="false" autocomplete="off"></label>` +
    `<label class="cfg-row"><span class="cfg-t">Instructions for the agent (optional)</span><span class="cfg-d">Added to every run started in this project, like a repo's AGENTS.md.</span><textarea rows="5" data-draft="proj:instructions" placeholder="Run npm test before every commit. Keep PRs under 400 lines.">${v('instructions', cur && cur.instructions)}</textarea></label>` +
    '</form>' + err(st.error);
  const del = cur ? (st.confirmDelete
    ? `<button type="button" class="btn destroy" data-proj-delete="${h(cur.id)}"${st.busy ? ' disabled' : ''}>Remove, ${plural(runsIn(cur.id).length, 'run')} to No project</button>`
    : `<button type="button" class="btn remove" data-proj-delete-ask="1">Remove project</button>`) : '';
  const foot = del + '<span class="grow"></span><button type="button" class="btn" data-close-sheet="1">Cancel</button>' +
    `<button type="button" class="btn primary" data-proj-save="1"${st.busy ? ' disabled' : ''}>${st.busy ? 'Saving' : cur ? 'Save' : 'Add project'}</button>`;
  return sheet('proj-h', cur ? 'Edit ' + h(cur.name) : 'New project', body, foot);
}

/** Projects, from the overflow menu: each with its run count and Edit, and New project. */
export function projectsSheetHtml() {
  const rows = projectList().map(p => {
    const n = runsIn(p.id).length;
    return `<li class="plrow">${sw(p.color)}<span class="sl">${h(projectName(p))}</span><span class="dim">${plural(n, 'run')}</span>` +
      (p.repo ? `<span class="mono dim">${h(p.repo)}</span>` : '') +
      (p.builtIn ? '<span class="dim">Built in</span>' : `<button type="button" class="btn" data-proj-edit="${h(p.id)}">Edit</button>`) + '</li>';
  }).join('');
  const body = '<p>Runs and Ship can show one project at a time. Each run\'s project chip moves it.</p>' + `<ul class="plist">${rows}</ul>`;
  return sheet('projs-h', 'Projects', body, '<button type="button" class="btn primary" data-proj-new="1">New project</button><span class="grow"></span><button type="button" class="btn" data-close-sheet="1">Close</button>');
}

export function moveSheetHtml() {
  const st = S.ui.move;
  const it = items().find(x => x.folder === st.folder);
  if (!it) { S.ui.move = null; return ''; }
  const now = projectOf(it);
  const rows = projectList().map(p => `<li><button type="button" class="srow mv${p.id === now ? ' on' : ''}" data-move-to="${h(p.id)}"${p.id === now || st.busy ? ' disabled' : ''}>${sw(p.color)}<span class="sl">${h(projectName(p))}</span>${p.id === now ? '<span class="dim">Here now</span>' : ''}</button></li>`).join('');
  const body = `<p>Only the listing changes. The work item, branches and sessions stay as they are.</p><ul class="mvlist">${rows}</ul>` + err(st.error);
  return sheet('move-h', 'Move ' + h(runLabel(it)), body, '<span class="grow"></span><button type="button" class="btn" data-close-sheet="1">Close</button>');
}
