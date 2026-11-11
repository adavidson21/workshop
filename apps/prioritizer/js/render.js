import { PR_TIER, prTip } from './ado.js';
import { ICON, LENSES, NAV, NAV_OF, OLD_VIEWS, POINTS, TOUCH, VALUE, VIEWS, initials, listColor } from './constants.js';
import { closeDrawer, drawerId, markSel, syncDrawer } from './drawer.js';
import { reportRoute } from './route.js';
import { engChip } from './eng.js';
import { slateFor, slateLabel } from './slate-link.js';
import { prAiChip } from './pr-ai.js';
import { closeSide } from './events.js';
import { ageDays, fmtScore, isStale, isTriaged, nudgeDue, score, stillUrgent, tier } from './model.js';
import { childrenOf, commit, hiddenCount, inboxQueue, isWaiting, listById, saveUi, scopeListIds, scopeName, shown, state, topLists, ui } from './state.js';
import { $, daysBetween, esc, fmtDay, fmtLong, today, todayStr } from './util.js';
import { embedded, ws } from './ws.js';
import { dayHead, renderDay } from './day-view.js';
import { dp } from './dayplan.js';
import { fmt12, repeatLabel } from './dayplan-model.js';
import { peopleFilter, renderArchive, renderPeople, renderToday } from './views.js';
import { activeTask, isActive, nextTask, renderNow, rowCrumb } from './focus.js';
import { namesOf } from './directory-model.js';
import { rowShown } from './row-fields-model.js';
import { productById } from './products-link.js';
/* Prioritizer: The frame: view switching, sidebar, page header, task rows, capacity line. */
/* ---------- views ---------- */
const main = $('#main'), app = $('#app'), drawer = $('#drawer');
let openQuad = null, weekOff = 0, doneOpen = false, sel = null;
// Today's columns: which one you work in ('inbox', 'rank', 'today' or null; where triage keys go and where Left
// and Right move from), and whether the Inbox is open over the page when the window is too narrow for three.
let col = null, inboxOpen = false;
// Plan week (Docket 7.0.0): the middle column is the full Ranked list with its lenses, and the Inbox and Today step
// aside as rails. Off, it is Up next: the top few ranked tasks. Kept in this browser, like the sidebar.
const planWeek = () => !!ui.planWeek;
function setPlanWeek(on){
  on = !!on;
  if (!on) state.lens = 'rank';
  if (planWeek() === on && state.view === 'today'){ render(); return; }
  ui.planWeek = on; saveUi();
  if (state.view !== 'today'){ state.view = 'today'; }
  openQuad = null;
  if (drawerId) closeDrawer(true);
  commit();
}
// Other modules change this view state through these setters (imported bindings are read-only).
const setSel = v => { sel = v; }, setOpenQuad = v => { openQuad = v; },
  setWeekOff = v => { weekOff = v; }, setDoneOpen = v => { doneOpen = v; }, setInboxOpen = v => { inboxOpen = v; };
function setCol(c){
  col = c;
  if (state.view !== 'today') return;
  main.querySelectorAll('.col').forEach(el => el.classList.toggle('colon', el.dataset.col === col));
}
/* Focus a column of Today: its first row. */
function focusCol(c){
  setCol(c);
  const el = main.querySelector(`.col[data-col="${c}"]`); if (!el) return;
  const f = el.querySelector('.row[data-id]') || el;
  if (f.classList.contains('row')){ sel = f.dataset.id; markSel(); }
  if (!f.hasAttribute('tabindex')) f.setAttribute('tabindex', '-1');
  f.focus({preventScroll: true}); f.scrollIntoView({block: 'nearest'});
}
/* Old views (links from other apps, saved windows, the 3 and 4 keys) open Today with a column or a lens. */
function setView(v){
  const old = OLD_VIEWS[v], wasWeek = state.view === 'today' && planWeek();
  if (old){
    if (old.lens) state.lens = old.lens;
    if (old.plan && !ui.planWeek){ ui.planWeek = true; saveUi(); }
    if (old.col === 'inbox' && ui.planWeek){ ui.planWeek = false; state.lens = 'rank'; saveUi(); }
    if (old.col === 'inbox'){ state.lens = 'rank'; inboxOpen = true; }
    v = 'today';
  }
  if (!VIEWS.includes(v)) return;
  const was = state.view;
  // Today is always Today: leaving Plan week is a route or click to Today like any other place.
  if (v === 'today' && !old && ui.planWeek){ ui.planWeek = false; state.lens = 'rank'; saveUi(); }
  state.view = v; openQuad = null; sel = null;
  // The task drawer belongs to the place it was opened in; another place closes it.
  if (drawerId && (was !== v || wasWeek !== (v === 'today' && planWeek()))) closeDrawer(true);
  if (v !== 'today'){ col = null; inboxOpen = false; }
  else if (old && old.col) col = old.col;
  closeSide();
  commit();
  if (was !== v) main.scrollTop = 0;
  if (old && old.col) requestAnimationFrame(() => focusCol(old.col));
}
/* A lens on Today's Ranked column: List, Eisenhower or Value / Effort. */
function setLens(k){
  if (!(k in LENSES)) return;
  state.lens = k; openQuad = null;
  if (k !== 'rank' && !ui.planWeek){ ui.planWeek = true; saveUi(); }
  if (state.view !== 'today') state.view = 'today';
  commit();
}
function setScope(id){
  state.scope = id; sel = null; closeSide(); commit();
}
function render(){
  if (isWaiting()) return renderWaiting();
  // A view name from before Docket 6.0 (a saved window, a test, another app): Today, with its lens.
  if (!VIEWS.includes(state.view)){ const o = OLD_VIEWS[state.view] || {}; if (o.lens) state.lens = o.lens; if (o.plan && !ui.planWeek){ ui.planWeek = true; saveUi(); } state.view = 'today'; }
  renderSide();
  renderHead();
  renderNow();
  const v = state.view;
  if (v === 'today') renderToday();
  else if (v === 'people') renderPeople();
  else if (v === 'archive') renderArchive();
  else if (v === 'day') renderDay();
  markSel();
  syncDrawer();
  reportRoute();
}

/* Waiting for the data folder (state.js, setWaiting): no board, nothing to add or edit, and where to click. */
function renderWaiting(){
  $('#snav').innerHTML = '';
  $('#slists').innerHTML = '';
  $('#phead').innerHTML = '';
  $('#main').innerHTML = `<div class="empty waiting-empty" role="status"><b>Allow Workshop to use your folder to see your board</b>`
    + (embedded ? 'Click <span class="kbdlike">Allow</span> in the bar at the top of Workshop. Chrome asks again after it restarts.'
      : 'Open Workshop and click <span class="kbdlike">Allow</span> in the bar at the top. Chrome asks again after it restarts.'
        + '<div class="acts"><button class="btn primary" data-open-workshop>Open Workshop</button></div>')
    + '</div>';
  const open = $('#main [data-open-workshop]');
  if (open) open.addEventListener('click', () => { if (ws) ws.open({app: 'prioritizer'}); });
}

/* sidebar */
function renderSide(){
  const nav = state.view === 'today' && planWeek() ? 'week' : NAV_OF(state.view);
  const inbox = inboxQueue().length;
  const tips = {today: `Today: Inbox, Up next and Today${inbox ? `. ${inbox} new to sort` : ''}. Shortcut: 1 (3 Inbox, 4 Plan week)`};
  // Today is where the day happens; Day plans it in time blocks; People and Done are for review. One count on Today:
  // what is in the Inbox to sort.
  const group = {day: 'Plan', people: 'Review'};
  $('#snav').innerHTML = NAV.map(([k, label, ic, key]) => `${group[k] ? `<div class="ssec snav-h"><span>${group[k]}</span></div>` : ''}<button class="sitem${nav === k ? ' on' : ''}" data-nav="${k}" aria-current="${nav === k ? 'page' : 'false'}" data-tip="${tips[k] || `${label}. Shortcut: ${key}`}">${ic}<span class="lbl">${label}</span>${
    k === 'today' && inbox ? `<span class="badge" aria-label="${inbox} new to sort">${inbox}</span>` : ''}</button>`).join('');
  // Counts follow the PR filter, so a hidden Team PR doesn't count anywhere. The Pull requests list counts all of
  // its PRs when "No PRs" is on, since picking it shows them.
  const vis = (t, id) => !t.done && (shown(t) || state.prs === 'none' && id === state.ado.prListId);
  const open = id => state.tasks.filter(t => vis(t, id) && (t.listId === id || childrenOf(id).some(c => c.id === t.listId))).length;
  const item = (l, sub) => {
    const n = sub ? state.tasks.filter(t => vis(t, l.id) && t.listId === l.id).length : open(l.id);
    const on = state.scope === l.id || (state.lists.length === 1 && state.scope === 'all');
    return `<div class="sitem${sub ? ' child' : ''}${on ? ' on' : ''}" data-scope="${l.id}" data-droplist="${l.id}" role="button" tabindex="0" aria-pressed="${on}">
      <i class="dot lc${listColor(l.id)}"></i><span class="lbl">${esc(l.name)}</span>${n ? `<span class="n">${n}</span>` : ''}
      <span class="ibtn more" data-menu="${l.id}" role="button" tabindex="0" aria-label="Options for ${esc(l.name)}" style="width:24px;height:24px">${ICON.dots}</span></div>`;
  };
  // "All lists" only means something once there are two lists to pick between.
  const one = state.lists.length === 1;
  $('#slists').innerHTML = (one ? '' : `<div class="sitem${state.scope === 'all' ? ' on' : ''}" data-scope="all" role="button" tabindex="0" aria-pressed="${state.scope === 'all'}"><i class="dot"></i><span class="lbl">All lists</span><span class="n">${state.tasks.filter(t => !t.done && shown(t)).length || ''}</span></div>`)
    + topLists().map(l => item(l, false) + childrenOf(l.id).map(c => item(c, true)).join('')).join('');
}

/* header */
// The scope, plus what the PR filter hides here, so a filtered view never looks like the whole board.
function scopeLabel(){
  const n = hiddenCount();
  return scopeName() + (n ? ` · ${n} ${state.prs === 'mine' ? 'team ' : ''}PR${n === 1 ? '' : 's'} hidden` : '');
}
// Header actions are round icon buttons; the tooltip and aria-label carry the words.
const hbtn = (icon, tip, attrs, cls = '') => `<button class="hbtn${cls ? ' ' + cls : ''}" ${attrs} aria-label="${esc(tip.split('.')[0])}" data-tip="${esc(tip)}">${icon}</button>`;
// The day's two actions also show their words on a wide window (app.css .hbtn.lab); an icon with a tooltip below that.
const lbtn = (icon, label, tip, attrs) => `<button class="hbtn lab" ${attrs} aria-label="${esc(label)}" data-tip="${esc(tip)}">${icon}<span class="hl">${esc(label)}</span></button>`;
const addBtn = () => hbtn(ICON.plus, 'Add a task. Shortcut: N', 'data-add', 'primary addbtn');
function renderHead(){
  const v = state.view;
  const week = v === 'today' && planWeek();
  const title = week ? 'Plan week' : {today: 'Today', people: 'People', archive: 'Done'}[v];
  if (v === 'day') return dayHead();
  let sub = esc(scopeLabel()), tools = '';
  if (week) sub = `Rank the week · ${sub}`;
  else if (v === 'today'){
    sub = `${new Date().toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric'})} · ${sub}`;
    const nx = !activeTask() && nextTask();
    tools = (nx ? hbtn(ICON.play, `Start: ${nx.title}. Shortcut: S`, 'data-now="startnext"') : '')
      + lbtn(ICON.day, 'Plan the day', 'Plan the day in time blocks. Shortcut: 2', 'data-view="day"')
      + lbtn(ICON.moon, 'Wrap up', "Wrap up: breadcrumbs and tomorrow's top 3", 'data-shutdown');
  }
  if (v === 'archive') sub += ` · ${state.tasks.filter(t => t.done && scopeListIds().includes(t.listId)).length} done`;
  if (v === 'people'){
    const f = peopleFilter();
    tools = `<div class="lens" role="tablist" aria-label="Show">${[['all', 'Everyone'], ['team', 'My team']].map(([k, n]) => `<button data-pfilter="${k}" role="tab" aria-selected="${f === k}"${f === k ? ' class="on"' : ''}>${n}</button>`).join('')}</div>`
      + hbtn(ICON.addPerson, 'Add a person', 'data-addperson');
  }
  $('#phead').innerHTML = `<button class="ibtn menu-btn" id="menuBtn" aria-label="Open menu">${ICON.menu}</button>
    <div class="ptitle"><h1>${title}</h1><button class="scopebtn" data-scopemenu aria-label="Change scope">${sub}${ICON.chevD}</button></div>
    ${tools ? `<div class="htools${v === 'today' || v === 'people' ? ' icons' : ''}">${tools}</div>` : ''}${v !== 'archive' ? `<div class="hadd">${addBtn()}</div>` : ''}`;
}

/* rows */
/* One task row. Optional fields follow the Row fields setting (state.rowFields, or o.hidden for the settings
   preview); alerts that need you show either way. o.preview: {names, list, agent, product} stand in for the directory,
   the board's lists and the agent's status, so the preview row shows every field. */
function row(t, o = {}){
  const on = rowShown(o.hidden || (state.rowFields && state.rowFields.hidden));
  const pv = o.preview || null;
  const multi = pv ? !!pv.list : scopeListIds().length > 1;
  const L = pv ? pv.list : listById(t.listId);
  const tr = t.done ? null : tier(t);
  const s = score(t);
  let meta = '';
  // Signals are icons with a tooltip (data-tip and aria-label say the words). Color only when it needs you.
  const sig = (icon, tip, cls = '', text = '') => `<span class="sig${cls ? ' ' + cls : ''}${text ? ' txt' : ''}" data-tip="${esc(tip)}" role="img" aria-label="${esc(tip)}">${icon}${text ? `<b>${esc(text)}</b>` : ''}</span>`;
  if (t.ado && on('ado')){
    const tip = `${t.ado.url ? 'Open ' : ''}ADO ${t.ado.type || 'item'} #${t.ado.id}${t.ado.state ? ', ' + t.ado.state : ''}`;
    meta += t.ado.url
      ? `<a class="sig ado txt" href="${esc(t.ado.url)}" target="_blank" rel="noopener" data-tip="${esc(tip)}" aria-label="${esc(tip)}">${ICON.item}<b>${t.ado.id}</b></a>`
      : sig(ICON.item, tip, 'ado', String(t.ado.id));
  }
  // Also on Slate's board (slate-link.js): where it stands there. Inside Workshop only; the drawer opens it.
  if (t.ado && !t.done && on('ado') && embedded && !pv){ const sl = slateFor(t.ado.id); if (sl) meta += sig(ICON.board, `${slateLabel(sl)}. Open the task to go there.`, 'slate'); }
  if (t.ado && !t.done && on('agent')) meta += pv ? (pv.agent || '') : engChip(t.ado.id);
  if (t.recur && on('repeat')){
    const item = dp.recurring.find(r => r.id === t.recur.id);
    const tip = item ? repeatLabel(item) + (t.recur.sprint ? `: sprint ${t.recur.sprint}` : '') : `Every sprint${t.recur.sprint ? `: sprint ${t.recur.sprint}` : ''}`;
    meta += sig(ICON.repeat, tip, 'recur', item && item.at ? fmt12(item.at) : '');
  }
  if (t.pr){
    if (on('pr')) meta += sig(ICON.pr, prTip(t.pr), 'ado', String(t.pr.id));
    if (!t.done && !t.pr.waiting){
      const tip = (t.pr.lastBlocker ? 'Last approval needed. ' : '') + PR_TIER[t.pr.tier].tip;
      if (t.pr.tier === 'blocking') meta += sig(ICON.block, tip, 'warn');
      else if (t.pr.tier === 'asked') meta += sig(ICON.eye, tip, 'acc');
    }
    if (on('prai')) meta += prAiChip(t);
  }
  if (!t.done){
    if (nudgeDue(t)) meta += sig(ICON.bell, `Time to nudge. Follow-up date ${fmtLong(t.nudgeOn)}`, 'acc');
    else if (t.waiting && on('waiting')) meta += t.nudgeOn ? sig(ICON.wait, `Waiting. Follow up ${fmtLong(t.nudgeOn)}`, '', fmtDay(t.nudgeOn)) : sig(ICON.wait, 'Waiting on someone');
    if (t.cameBack && !t.waiting && on('waiting')) meta += sig(ICON.back, `Came back ${fmtLong(t.cameBack)}`, 'acc');
    const d = t.due ? daysBetween(today(), t.due) : 0;
    if (t.due && (d < 0 || on('due'))){   // overdue shows even with due dates hidden
      meta += sig(ICON.cal, `${d < 0 ? 'Overdue. ' : ''}Due ${fmtLong(t.due)}`, d < 0 ? 'warn' : d <= 3 ? 'soon' : '', fmtDay(t.due));
    }
    if (stillUrgent(t)) meta += `<button class="sig warn" data-act="still" data-tip="Urgent for over a week. Click to make it not urgent." aria-label="Still urgent? Click to make it not urgent">${ICON.alert}</button>`;
    else if (isStale(t) && on('stale')) meta += sig(ICON.stale, `Stale: untouched for ${ageDays(t)} days. Do it, give it a date, or won't do. Plan week lists them.`, 'stale');
  }
  if (!o.compact && on('people')){
    const ppl = pv ? pv.names : namesOf(t.who.filter(p => p !== o.skipPerson));
    if (ppl.length) meta += `<span class="who" data-tip="${esc(ppl.join(', '))}" role="img" aria-label="${esc(ppl.join(', '))}">${ppl.slice(0, 2).map(p => `<i class="av">${esc(initials(p))}</i>`).join('')}${ppl.length > 2 ? `<i class="av more">+${ppl.length - 2}</i>` : ''}</span>`;
  }
  // The product it is for (products-link.js): its name, so it reads at a glance.
  const prodName = pv ? pv.product : t.product ? (productById(t.product) || {}).name : '';
  if (prodName && !o.compact && on('product')) meta += sig(ICON.box, `Product: ${prodName}`, 'prod', prodName);
  if ((!o.compact || o.showList) && multi && L && on('list')) meta += `<span class="lst" data-tip="${esc(L.name)}" role="img" aria-label="List: ${esc(L.name)}"><i class="lc${listColor(L.id)}"></i></span>`;
  const fon = t.focusOn === todayStr();
  // The score is on hover; the rank number already says the order.
  const scoreHtml = t.done || o.noScore || o.lean || !on('score') ? '' : s != null ? `<span class="score" data-tip="Score: (value + urgency) / effort">${fmtScore(s)}</span>`
    : o.estimate && !t.done ? `<span class="score none" data-tip="No estimate yet. Set value and effort in the Inbox." role="img" aria-label="No estimate">${ICON.noest}</span>`
    : t.done ? '' : '<span class="score"></span>';   // keeps the list dots in one column
  const act = !pv && !t.done && isActive(t.id), crumb = o.crumb && on('crumb') ? rowCrumb(t) : '';
  // A PR's chip already says it's a review, so the row drops the "Review: " its title starts with.
  const title = t.pr ? t.title.replace(/^Review:\s*/, '') : t.title;
  return `<article class="row${t.done ? ' done' : ''}${o.dim && !t.done ? ' ontoday' : ''}${!t.done && t.pr && t.pr.ai && t.pr.ai.state === 'pending' ? ' aipend' : ''}${act ? ' active' : ''}${o.top ? ' top' : ''}${o.compact ? ' compact' : ''}" data-id="${t.id}"${tr ? ` data-tier="${tr}"` : ''} draggable="true" tabindex="0" aria-label="${esc(t.title)}">`
    + (o.rank != null ? `<span class="rank">${o.rank}</span>` : '')
    + `<button class="check" data-act="done" aria-label="${t.done ? 'Reopen' : 'Complete'}" title="${t.done ? 'Reopen' : 'Complete'}"><i>${ICON.check}</i></button>`
    // On Today, where you left off sits under the title, so the morning starts where yesterday stopped.
    + (crumb ? `<span class="tcol"><span class="title">${esc(title)}</span>${crumb}</span>` : `<span class="title">${esc(title)}</span>`)
    + (meta ? `<span class="meta">${meta}</span>` : '')
    // Value and effort in words: only on a wide Ranked column (app.css), where the row has the room.
    + (!t.done && !pv && !o.lean && isTriaged(t) && !o.compact && VALUE[t.value] && t.effort ? `<span class="veff" aria-label="Value ${esc(VALUE[t.value])}, effort ${esc(t.effort)}">${esc(VALUE[t.value])} · ${esc(t.effort)}</span>` : '')
    + scoreHtml
    + (o.start && !t.done && (on('start') || act) ? `<button class="tstart${act ? ' on' : ''}" data-act="start" aria-pressed="${act}" aria-label="${act ? 'Pause' : 'Start'}" data-tip="${act ? 'Pause' : 'Work on this now'}. Shortcut: S">${act ? ICON.pause : ICON.play}</button>` : '')
    + (o.follow && t.waiting && !t.done && !pv ? `<button class="tfol" data-act="nudged" aria-label="Nudged" data-tip="Nudged: follow up again later">${ICON.nudge}</button><button class="tfol" data-act="gotback" aria-label="Got it back" data-tip="Got it back: stop waiting">${ICON.back}</button>` : '')
    + (o.back && t.cameBack && !t.done && !pv ? `<button class="tfol" data-act="dismissback" aria-label="Dismiss" data-tip="Seen it. Keep it where it is in your list">${ICON.x}</button>` : '')
    // One-key sorting on an Inbox row (views.js): value buttons on hover, the same as 1 to 4.
    + (o.sort && !t.done && !pv ? `<span class="qsort" role="group" aria-label="Sort by value">${[1, 2, 3, 4].map(v => `<button class="qv" data-qv="${v}" aria-label="${VALUE[v]}" data-tip="${VALUE[v]}. Shortcut: ${v}">${v}</button>`).join('')}</span>` : '')
    + (t.done || pv || o.noAssign ? '' : `<button class="twho${o.assignOn ? ' on' : ''}" data-act="assign" aria-label="Delegate or add people" data-tip="Delegate or add people. Shortcut: A">${ICON.addPerson}</button>`)
    + (t.done || o.noToday || !on('today') ? '' : `<button class="tday${fon ? ' on' : ''}" data-act="today" aria-pressed="${fon}" aria-label="${fon ? 'Remove from Today' : 'Add to Today'}" data-tip="${fon ? 'Remove from Today' : 'Add to Today'}. Shortcut: T">${ICON.sun}</button>`)
    + `</article>`;
}
const doneGroup = (ts, label = 'Done today') => ts.length ? `<details class="donegrp" id="doneGrp"${doneOpen ? ' open' : ''}><summary>${ICON.tri}${label} <span class="num">${ts.length}</span></summary>
  <div class="rows">${ts.map(t => row(t, {compact: true})).join('')}</div></details>` : '';
const emptyHTML = `<div class="empty"><b>No tasks yet.</b>${TOUCH ? 'Tap + to add one.' : 'Press N to add one.'}<div class="acts"><button class="btn primary" data-add>Add a task</button><button class="btn" data-tour>Take the tour</button></div></div>`;

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

export { col, focusCol, inboxOpen, planWeek, setPlanWeek, setCol, setInboxOpen, setLens, app, capacityCut, scopeLabel, doneGroup, doneOpen, drawer, emptyHTML, main, openQuad, render, row, sel, setDoneOpen, setOpenQuad, setScope, setSel, setView, setWeekOff, weekOff };
