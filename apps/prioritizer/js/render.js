import { PR_TIER, prTip } from './ado.js';
import { ICON, LENSES, NAV, NAV_OF, POINTS, TOUCH, VIEWS, initials, listColor } from './constants.js';
import { markSel, syncDrawer } from './drawer.js';
import { engChip } from './eng.js';
import { prAiChip } from './pr-ai.js';
import { closeSide } from './events.js';
import { ageDays, fmtScore, isStale, isTriaged, nudgeDue, score, stillUrgent, tier } from './model.js';
import { childrenOf, commit, isWaiting, listById, scopeListIds, scopeName, scopeOpen, state, topLists, triageQueue } from './state.js';
import { $, daysBetween, esc, fmtDay, fmtLong, plural, today, todayStr } from './util.js';
import { embedded, ws } from './ws.js';
import { dayHead, renderDay } from './day-view.js';
import { dp } from './dayplan.js';
import { fmt12, repeatLabel } from './dayplan-model.js';
import { renderArchive, renderMatrix, renderPeople, renderRank, renderToday, renderTriage } from './views.js';
import { activeTask, isActive, nextTask, renderNow, rowCrumb } from './focus.js';
import { namesOf } from './directory-model.js';
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
  if (isWaiting()) return renderWaiting();
  renderSide();
  renderHead();
  renderNow();
  const v = state.view;
  if (v === 'rank') renderRank();
  else if (v === 'today') renderToday();
  else if (v === 'triage') renderTriage();
  else if (v === 'people') renderPeople();
  else if (v === 'archive') renderArchive();
  else if (v === 'day') renderDay();
  else renderMatrix(v);
  markSel();
  syncDrawer();
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
  const nav = NAV_OF(state.view);
  const ids = scopeListIds();
  const counts = {
    today: state.tasks.filter(t => !t.done && ids.includes(t.listId) && t.focusOn === todayStr()).length,
    triage: triageQueue().length
  };
  $('#snav').innerHTML = NAV.map(([k, label, ic, key]) => `<button class="sitem${nav === k ? ' on' : ''}" data-nav="${k}" aria-current="${nav === k ? 'page' : 'false'}" data-tip="${label}. Shortcut: ${key}">${ic}<span class="lbl">${label}</span>${
    k === 'triage' && counts.triage ? `<span class="badge" aria-label="${counts.triage} to triage">${counts.triage}</span>`
    : k === 'today' && counts.today ? `<span class="n">${counts.today}</span>` : ''}</button>`).join('');
  const open = id => state.tasks.filter(t => !t.done && (t.listId === id || childrenOf(id).some(c => c.id === t.listId))).length;
  const item = (l, sub) => {
    const n = sub ? state.tasks.filter(t => !t.done && t.listId === l.id).length : open(l.id);
    const on = state.scope === l.id || (state.lists.length === 1 && state.scope === 'all');
    return `<div class="sitem${sub ? ' child' : ''}${on ? ' on' : ''}" data-scope="${l.id}" data-droplist="${l.id}" role="button" tabindex="0" aria-pressed="${on}">
      <i class="dot lc${listColor(l.id)}"></i><span class="lbl">${esc(l.name)}</span>${n ? `<span class="n">${n}</span>` : ''}
      <span class="ibtn more" data-menu="${l.id}" role="button" tabindex="0" aria-label="Options for ${esc(l.name)}" style="width:24px;height:24px">${ICON.dots}</span></div>`;
  };
  // "All lists" only means something once there are two lists to pick between.
  const one = state.lists.length === 1;
  $('#slists').innerHTML = (one ? '' : `<div class="sitem${state.scope === 'all' ? ' on' : ''}" data-scope="all" role="button" tabindex="0" aria-pressed="${state.scope === 'all'}"><i class="dot"></i><span class="lbl">All lists</span><span class="n">${state.tasks.filter(t => !t.done).length || ''}</span></div>`)
    + topLists().map(l => item(l, false) + childrenOf(l.id).map(c => item(c, true)).join('')).join('');
}

/* header */
// Header actions are round icon buttons; the tooltip and aria-label carry the words.
const hbtn = (icon, tip, attrs, cls = '') => `<button class="hbtn${cls ? ' ' + cls : ''}" ${attrs} aria-label="${esc(tip.split('.')[0])}" data-tip="${esc(tip)}">${icon}</button>`;
const addBtn = () => hbtn(ICON.plus, 'Add a task. Shortcut: N', 'data-add', 'primary addbtn');
function renderHead(){
  const v = state.view, nav = NAV_OF(v);
  const title = {today: 'Today', triage: 'Triage', prio: 'Prioritize', people: 'People'}[nav];
  if (v === 'day') return dayHead();
  let sub = esc(scopeName()), tools = '';
  if (v === 'today'){
    sub = `${new Date().toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric'})} · ${sub}`;
    const nx = !activeTask() && nextTask();
    tools = (nx ? hbtn(ICON.play, `Start: ${nx.title}. Shortcut: S`, 'data-now="startnext"') : '')
      + hbtn(ICON.day, 'Plan the day in time blocks. Shortcut: 2', 'data-view="day"')
      + hbtn(ICON.moon, "Wrap up: breadcrumbs and tomorrow's top 3", 'data-shutdown');
  }
  if (nav === 'prio'){
    const open = scopeOpen().length;
    sub += v === 'archive' ? ` · ${state.tasks.filter(t => t.done && scopeListIds().includes(t.listId)).length} done` : ` · ${open} open`;
    tools = `<div class="lens" role="tablist" aria-label="Prioritize by">${Object.entries({...LENSES, archive: 'Done'}).map(([k, n]) =>
      `<button data-view="${k}" role="tab" aria-selected="${v === k}"${v === k ? ' class="on"' : ''}>${n}</button>`).join('')}</div>`;
    if (v === 'rank') tools += `<label class="cap" data-tip="Weekly capacity in effort points (XS 1, S 2, M 3, L 5, XL 8)">${ICON.gauge}<input type="number" id="capIn" class="mono" min="1" max="999" value="${state.capacity}" aria-label="Weekly capacity in points"></label>
      ${open > 1 ? hbtn(ICON.wand, 'Suggest an order by score (you preview it first)', 'data-suggest') : ''}`;
  }
  if (v === 'triage') sub += ` · ${plural(triageQueue().length, 'task')} to sort`;
  if (v === 'people') tools = hbtn(ICON.addPerson, 'Add a person', 'data-addperson');
  $('#phead').innerHTML = `<button class="ibtn menu-btn" id="menuBtn" aria-label="Open menu">${ICON.menu}</button>
    <div class="ptitle"><h1>${title}</h1><button class="scopebtn" data-scopemenu aria-label="Change scope">${sub}${ICON.chevD}</button></div>
    ${tools ? `<div class="htools${v === 'today' || v === 'people' ? ' icons' : ''}">${tools}</div>` : ''}${v !== 'archive' ? `<div class="hadd">${addBtn()}</div>` : ''}`;
}

/* rows */
function row(t, o = {}){
  const multi = scopeListIds().length > 1;
  const L = listById(t.listId);
  const tr = t.done ? null : tier(t);
  const s = score(t);
  let meta = '';
  // Signals are icons with a tooltip (data-tip and aria-label say the words). Color only when it needs you.
  const sig = (icon, tip, cls = '', text = '') => `<span class="sig${cls ? ' ' + cls : ''}${text ? ' txt' : ''}" data-tip="${esc(tip)}" role="img" aria-label="${esc(tip)}">${icon}${text ? `<b>${esc(text)}</b>` : ''}</span>`;
  if (t.ado){
    const tip = `${t.ado.url ? 'Open ' : ''}ADO ${t.ado.type || 'item'} #${t.ado.id}${t.ado.state ? ', ' + t.ado.state : ''}`;
    meta += t.ado.url
      ? `<a class="sig ado txt" href="${esc(t.ado.url)}" target="_blank" rel="noopener" data-tip="${esc(tip)}" aria-label="${esc(tip)}">${ICON.item}<b>${t.ado.id}</b></a>`
      : sig(ICON.item, tip, 'ado', String(t.ado.id));
  }
  if (t.ado && !t.done) meta += engChip(t.ado.id);
  if (t.recur){
    const item = dp.recurring.find(r => r.id === t.recur.id);
    const tip = item ? repeatLabel(item) + (t.recur.sprint ? `: sprint ${t.recur.sprint}` : '') : `Every sprint${t.recur.sprint ? `: sprint ${t.recur.sprint}` : ''}`;
    meta += sig(ICON.repeat, tip, 'recur', item && item.at ? fmt12(item.at) : '');
  }
  if (t.pr){
    meta += sig(ICON.pr, prTip(t.pr), 'ado', String(t.pr.id));
    if (!t.done && !t.pr.waiting){
      const tip = (t.pr.lastBlocker ? 'Last approval needed. ' : '') + PR_TIER[t.pr.tier].tip;
      if (t.pr.tier === 'blocking') meta += sig(ICON.block, tip, 'warn');
      else if (t.pr.tier === 'asked') meta += sig(ICON.eye, tip, 'acc');
    }
    meta += prAiChip(t);
  }
  if (!t.done){
    if (nudgeDue(t)) meta += sig(ICON.bell, `Time to nudge. Follow-up date ${fmtLong(t.nudgeOn)}`, 'acc');
    else if (t.waiting) meta += sig(ICON.wait, 'Waiting on someone');
    if (t.due){
      const d = daysBetween(today(), t.due);
      meta += sig(ICON.cal, `${d < 0 ? 'Overdue. ' : ''}Due ${fmtLong(t.due)}`, d < 0 ? 'warn' : d <= 3 ? 'soon' : '', fmtDay(t.due));
    }
    if (stillUrgent(t)) meta += `<button class="sig warn" data-act="still" data-tip="Urgent for over a week. Click to make it not urgent." aria-label="Still urgent? Click to make it not urgent">${ICON.alert}</button>`;
    else if (isStale(t)) meta += sig(ICON.stale, `Untouched for ${ageDays(t)} days. It's back in Triage.`, 'stale');
  }
  if (!o.compact){
    const ppl = namesOf(t.who.filter(p => p !== o.skipPerson));
    if (ppl.length) meta += `<span class="who" data-tip="${esc(ppl.join(', '))}" role="img" aria-label="${esc(ppl.join(', '))}">${ppl.slice(0, 2).map(p => `<i class="av">${esc(initials(p))}</i>`).join('')}${ppl.length > 2 ? `<i class="av more">+${ppl.length - 2}</i>` : ''}</span>`;
  }
  if ((!o.compact || o.showList) && multi && L) meta += `<span class="lst" data-tip="${esc(L.name)}" role="img" aria-label="List: ${esc(L.name)}"><i class="lc${listColor(L.id)}"></i></span>`;
  const fon = t.focusOn === todayStr();
  // The score is on hover; the priority bar on the left already shows the tier.
  const scoreHtml = t.done || o.noScore ? '' : s != null ? `<span class="score" data-tip="Score: (value + urgency) / effort">${fmtScore(s)}</span>`
    : o.estimate && !t.done ? `<span class="score none" data-tip="No estimate yet. Set value and effort in Triage." role="img" aria-label="No estimate">${ICON.noest}</span>`
    : t.done ? '' : '<span class="score"></span>';   // keeps the list dots in one column
  const act = !t.done && isActive(t.id), crumb = o.crumb ? rowCrumb(t) : '';
  return `<article class="row${t.done ? ' done' : ''}${!t.done && t.pr && t.pr.ai && t.pr.ai.state === 'pending' ? ' aipend' : ''}${act ? ' active' : ''}${o.top ? ' top' : ''}${o.compact ? ' compact' : ''}" data-id="${t.id}"${tr ? ` data-tier="${tr}"` : ''} draggable="true" tabindex="0" aria-label="${esc(t.title)}">`
    + (o.rank != null ? `<span class="rank">${o.rank}</span>` : '')
    + `<button class="check" data-act="done" aria-label="${t.done ? 'Reopen' : 'Complete'}" title="${t.done ? 'Reopen' : 'Complete'}"><i>${ICON.check}</i></button>`
    // On Today, where you left off sits under the title, so the morning starts where yesterday stopped.
    + (crumb ? `<span class="tcol"><span class="title">${esc(t.title)}</span>${crumb}</span>` : `<span class="title">${esc(t.title)}</span>`)
    + (meta ? `<span class="meta">${meta}</span>` : '')
    + scoreHtml
    + (o.start && !t.done ? `<button class="tstart${act ? ' on' : ''}" data-act="start" aria-pressed="${act}" aria-label="${act ? 'Pause' : 'Start'}" data-tip="${act ? 'Pause' : 'Work on this now'}. Shortcut: S">${act ? ICON.pause : ICON.play}</button>` : '')
    + (t.done || o.noToday ? '' : `<button class="tday${fon ? ' on' : ''}" data-act="today" aria-pressed="${fon}" aria-label="${fon ? 'Remove from Today' : 'Add to Today'}" data-tip="${fon ? 'Remove from Today' : 'Add to Today'}. Shortcut: T">${ICON.sun}</button>`)
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

export { app, capacityCut, doneGroup, doneOpen, drawer, emptyHTML, main, openQuad, prevView, render, row, sel, setDoneOpen, setOpenQuad, setScope, setSel, setShowAllPick, setView, setWeekOff, showAllPick, tri, weekOff };
