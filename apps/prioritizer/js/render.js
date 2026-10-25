import { PR_TIER, adoShort, prTip } from './ado.js';
import { ICON, LENSES, NAV, NAV_OF, POINTS, VIEWS } from './constants.js';
import { markSel, syncDrawer } from './drawer.js';
import { engChip } from './eng.js';
import { closeSide } from './events.js';
import { ageDays, fmtScore, isStale, isTriaged, nudgeDue, score, stillUrgent, tier } from './model.js';
import { renderReports, rpHead } from './reports.js';
import { childrenOf, commit, listById, scopeListIds, scopeName, scopeOpen, state, topLists, triageQueue } from './state.js';
import { $, daysBetween, esc, fmtDay, fmtLong, plural, today, todayStr } from './util.js';
import { renderArchive, renderMatrix, renderPeople, renderRank, renderToday, renderTriage } from './views.js';
/* Prioritizer: The frame: view switching, sidebar, page header, task rows, capacity line. */
/* ---------- views ---------- */
const main = $('#main'), app = $('#app'), drawer = $('#drawer');
let openQuad = null, showAllPick = false, weekOff = 0, doneOpen = false, sel = null, prevView = 'today';
let tri = {seen: new Set(), draft: null, id: null};
// Other modules change this view state through these setters (imported bindings are read-only).
const setSel = v => { sel = v; }, setOpenQuad = v => { openQuad = v; }, setShowAllPick = v => { showAllPick = v; },
  setWeekOff = v => { weekOff = v; }, setDoneOpen = v => { doneOpen = v; };
function setView(v){
  if (!VIEWS.includes(v)) return;
  if (v === 'triage' && state.view !== 'triage'){ prevView = state.view; tri = {seen: new Set(), draft: null, id: null}; }
  if (v in LENSES) state.lens = v;
  state.view = v; openQuad = null; sel = null;
  closeSide();
  commit();
  main.scrollTop = 0;
}
function setScope(id){
  state.scope = id; sel = null; closeSide(); commit();
}
function render(){
  renderSide();
  renderHead();
  const v = state.view;
  if (v === 'rank') renderRank();
  else if (v === 'today') renderToday();
  else if (v === 'triage') renderTriage();
  else if (v === 'people') renderPeople();
  else if (v === 'archive') renderArchive();
  else if (v === 'reports') renderReports();
  else renderMatrix(v);
  markSel();
  syncDrawer();
}

/* sidebar */
function renderSide(){
  const nav = NAV_OF(state.view);
  const ids = scopeListIds();
  const counts = {
    today: state.tasks.filter(t => !t.done && ids.includes(t.listId) && t.focusOn === todayStr()).length,
    triage: triageQueue().length
  };
  $('#snav').innerHTML = NAV.map(([k, label, ic], i) => `<button class="sitem${nav === k ? ' on' : ''}" data-nav="${k}" aria-current="${nav === k ? 'page' : 'false'}" data-tip="${label}. Shortcut: ${i + 1}">${ic}<span class="lbl">${label}</span>${
    k === 'triage' && counts.triage ? `<span class="badge" aria-label="${counts.triage} to triage">${counts.triage}</span>`
    : k === 'today' && counts.today ? `<span class="n">${counts.today}</span>` : ''}</button>`).join('');
  const open = id => state.tasks.filter(t => !t.done && (t.listId === id || childrenOf(id).some(c => c.id === t.listId))).length;
  const item = (l, sub) => {
    const n = sub ? state.tasks.filter(t => !t.done && t.listId === l.id).length : open(l.id);
    const on = state.scope === l.id || (state.lists.length === 1 && state.scope === 'all');
    return `<div class="sitem${sub ? ' child' : ''}${on ? ' on' : ''}" data-scope="${l.id}" data-droplist="${l.id}" role="button" tabindex="0" aria-pressed="${on}">
      <i class="dot"></i><span class="lbl">${esc(l.name)}</span>${n ? `<span class="n">${n}</span>` : ''}
      <span class="ibtn more" data-menu="${l.id}" role="button" tabindex="0" aria-label="Options for ${esc(l.name)}" style="width:24px;height:24px">${ICON.dots}</span></div>`;
  };
  // "All lists" only means something once there are two lists to pick between.
  const one = state.lists.length === 1;
  $('#slists').innerHTML = (one ? '' : `<div class="sitem${state.scope === 'all' ? ' on' : ''}" data-scope="all" role="button" tabindex="0" aria-pressed="${state.scope === 'all'}"><i class="dot"></i><span class="lbl">All lists</span><span class="n">${state.tasks.filter(t => !t.done).length || ''}</span></div>`)
    + topLists().map(l => item(l, false) + childrenOf(l.id).map(c => item(c, true)).join('')).join('');
}

/* header */
const addBtn = (label = 'Add task') => `<button class="btn primary addbtn" data-add data-tip="Add a task. Shortcut: N or Ctrl+K">${ICON.plus}<span class="lbl">${label}</span><kbd>N</kbd></button>`;
function renderHead(){
  const v = state.view, nav = NAV_OF(v);
  const title = {today: 'Today', triage: 'Triage', prio: 'Prioritize', people: 'People'}[nav];
  if (v === 'reports') return rpHead();
  let sub = esc(scopeName()), tools = '';
  if (v === 'today') sub = `${new Date().toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric'})} · ${sub}`;
  if (nav === 'prio'){
    const open = scopeOpen().length;
    sub += v === 'archive' ? ` · ${state.tasks.filter(t => t.done && scopeListIds().includes(t.listId)).length} done` : ` · ${open} open`;
    tools = `<div class="lens" role="tablist" aria-label="Prioritize by">${Object.entries({...LENSES, archive: 'Done'}).map(([k, n]) =>
      `<button data-view="${k}" role="tab" aria-selected="${v === k}"${v === k ? ' class="on"' : ''}>${n}</button>`).join('')}</div>`;
    if (v === 'rank') tools += `<label class="cap" data-tip="Weekly budget in effort points (XS 1, S 2, M 3, L 5, XL 8)"><span class="hide-sm">Capacity</span> <input type="number" id="capIn" class="mono" min="1" max="999" value="${state.capacity}" aria-label="Weekly capacity in points"> pts</label>
      ${open > 1 ? `<button class="btn" data-suggest data-tip="Preview an order by score">Suggest order</button>` : ''}`;
  }
  if (v === 'triage') sub += ` · ${plural(triageQueue().length, 'task')} to sort`;
  if (v === 'people') tools = `<button class="btn" data-addperson>${ICON.plus}<span class="hide-sm">Person</span></button>`;
  $('#phead').innerHTML = `<button class="ibtn menu-btn" id="menuBtn" aria-label="Open menu">${ICON.menu}</button>
    <div class="ptitle"><h1>${title}</h1><button class="scopebtn" data-scopemenu aria-label="Change scope">${sub}${ICON.chevD}</button></div>
    ${tools ? `<div class="htools">${tools}</div>` : ''}${v !== 'archive' ? `<div class="hadd">${addBtn()}</div>` : ''}`;
}

/* rows */
function row(t, o = {}){
  const multi = scopeListIds().length > 1;
  const L = listById(t.listId);
  const tr = t.done ? null : tier(t);
  const s = score(t);
  let meta = '';
  if (t.ado) meta += `<span class="chip ado" data-tip="ADO ${esc(t.ado.type)} #${t.ado.id}, ${esc(t.ado.state)}">${esc(adoShort(t.ado.type))} ${t.ado.id}</span>`;
  if (t.ado && !t.done) meta += engChip(t.ado.id);
  if (t.pr){
    meta += `<span class="chip ado" data-tip="${esc(prTip(t.pr))}">PR ${t.pr.id}</span>`;
    if (!t.done && !t.pr.waiting) meta += `<span class="chip${t.pr.tier === 'blocking' ? ' warn' : t.pr.tier === 'asked' ? ' acc' : ''}" data-tip="${esc(PR_TIER[t.pr.tier].tip)}">${t.pr.lastBlocker ? 'Last approval' : PR_TIER[t.pr.tier].label}</span>`;
  }
  if (!t.done){
    if (nudgeDue(t)) meta += `<span class="chip warn" data-tip="Follow-up date ${fmtLong(t.nudgeOn)}">Nudge</span>`;
    else if (t.waiting) meta += `<span class="chip">Waiting</span>`;
    if (t.due){
      const d = daysBetween(today(), t.due);
      meta += `<span class="chip${d < 0 ? ' warn' : d <= 3 ? ' acc' : ''}" data-tip="Due ${fmtLong(t.due)}">${d < 0 ? 'Overdue ' : ''}${fmtDay(t.due)}</span>`;
    }
    if (stillUrgent(t)) meta += `<button class="chip warn" data-act="still" data-tip="Urgent for over a week. Click to make it not urgent.">Still urgent?</button>`;
    else if (isStale(t)) meta += `<span class="chip" data-tip="Older than its window. It's back in Triage.">Stale</span>`;
  }
  if (!o.compact){
    const ppl = t.people.filter(p => p !== o.skipPerson);
    if (ppl.length) meta += `<span class="who">${ppl.map(p => '@' + esc(p)).join(' ')}</span>`;
    if (multi && L) meta += `<span class="lst"><i></i>${esc(L.name)}</span>`;
    if (!t.done) meta += `<span class="age" data-tip="Age">${ageDays(t)}d</span>`;
  } else if (o.showList && multi && L) meta += `<span class="lst"><i></i>${esc(L.name)}</span>`;
  const fon = t.focusOn === todayStr();
  const scoreHtml = t.done || o.noScore ? '' : s != null ? `<span class="score" data-tip="Score: (value + urgency) / effort">${fmtScore(s)}</span>`
    : o.estimate && !t.done ? `<span class="score none">no estimate</span>` : '';
  return `<article class="row${t.done ? ' done' : ''}${o.top ? ' top' : ''}${o.compact ? ' compact' : ''}" data-id="${t.id}"${tr ? ` data-tier="${tr}"` : ''} draggable="true" tabindex="0" aria-label="${esc(t.title)}">`
    + (o.rank != null ? `<span class="rank">${o.rank}</span>` : '')
    + `<button class="check" data-act="done" aria-label="${t.done ? 'Reopen' : 'Complete'}" title="${t.done ? 'Reopen' : 'Complete'}"><i>${ICON.check}</i></button>`
    + `<span class="title">${esc(t.title)}</span>`
    + (meta ? `<span class="meta">${meta}</span>` : '')
    + scoreHtml
    + (t.done || o.noToday ? '' : `<button class="tday${fon ? ' on' : ''}" data-act="today" aria-pressed="${fon}" data-tip="${fon ? 'Remove from Today' : 'Add to Today'}. Shortcut: T">Today</button>`)
    + `</article>`;
}
const doneGroup = (ts, label = 'Done today') => ts.length ? `<details class="donegrp" id="doneGrp"${doneOpen ? ' open' : ''}><summary>${ICON.tri}${label} <span class="num">${ts.length}</span></summary>
  <div class="rows">${ts.map(t => row(t, {compact: true})).join('')}</div></details>` : '';
const emptyHTML = `<div class="empty"><b>A clean slate.</b>Press N to add your first task. It shows up in every view.</div>`;

/* capacity: line goes after the last task that fits (Build spec: Capacity line) */
function capacityCut(open){
  let sum = 0, cut = -1;
  for (let i = 0; i < open.length; i++){
    const pts = isTriaged(open[i]) ? POINTS[open[i].effort] : 0;
    if (sum + pts <= state.capacity){ sum += pts; cut = i; }
    else break;
  }
  if (cut === -1 && open.length){ cut = 0; sum = POINTS[open[0].effort] || 0; }
  return {cut, sum};
}

export { app, capacityCut, doneGroup, doneOpen, drawer, emptyHTML, main, openQuad, prevView, render, row, sel, setDoneOpen, setOpenQuad, setScope, setSel, setShowAllPick, setView, setWeekOff, showAllPick, tri, weekOff };
