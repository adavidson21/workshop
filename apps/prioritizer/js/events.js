import { addTask, downgradeUrgent, moveTask, quickSort, toggleDone, toggleFocus } from './actions.js';
import { adoSetup, onAdoClick } from './ado.js';
import { openSettings as daySettings, stepDay } from './day-view.js';
import { openSortRun } from './sort-run.js';
import { closeCmd, cmd, cmdOpen, openCmd } from './command-bar.js';
import { EMBEDDED, NAV_KEYS } from './constants.js';
import { takePasted } from './paste.js';
import { closeDrawer, copyTaskLink, drawerId, drawerOverlay, focusSel, markSel, moveSel, openDrawer } from './drawer.js';
import { engOpen } from './eng.js';
import { prAiOpen } from './pr-ai.js';
import { askText, closeMenu, closeModal, confirmBox, menuEl, modal, openListMenu, openScopeMenu, openThemeMenu, popMenu, showHelp, suggestPreview, toast, trapTab } from './overlays.js';
import { openPersonMenu } from './people.js';
import { openDisplay } from './display.js';
import { app, col, drawer, focusCol, inboxOpen, main, openQuad, planWeek, render, sel, setCol, setDoneOpen, setInboxOpen, setLens, setOpenQuad, setPlanWeek, setScope, setSel, setView, setWeekOff, weekOff } from './render.js';
import { commit, findTask, inScope, isWaiting, saveUi, scopeListIds, state, ui } from './state.js';
import { importFile, onSyncClick } from './storage.js';
import { $, isDate, plural, todayStr, uid } from './util.js';
import { activeTask, askCrumb, logInterrupt, openShutdown, pauseTask, startNext, toggleStart } from './focus.js';
import { addPerson } from './directory.js';
import { dismissBack, gotBackTask, nudgedTask, openAssign, toggleWaiting } from './delegate.js';
import { nameOf } from './directory-model.js';
import { carryLeft, closeNeed, openNeed, openInboxAnyway, setPeopleFilter, setReviewsOpen, setTrayQ, sortKey, toggleStaleOnly, copyText, recapData, recapText } from './views.js';
import { leftOffClick } from './left-off.js';
/* Prioritizer: Sidebar collapse, global click/keyboard handlers, day rollover, tooltips. */
/* ---------- sidebar collapse + mobile menu ---------- */
let midOpen = false, mobileOpen = false;
function applySide(){
  const w = innerWidth;
  const collapsed = w >= 1100 ? !!ui.collapsed : w >= 760 ? !midOpen : false;
  app.classList.toggle('collapsed', collapsed);
  app.classList.toggle('side-open', w < 760 && mobileOpen);
  const b = $('#collapseBtn');
  b.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  b.dataset.tip = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
}
function toggleCollapse(){
  if (innerWidth >= 1100){ ui.collapsed = !ui.collapsed; saveUi(); } else midOpen = !midOpen;
  applySide();
}
function closeSide(){ if (mobileOpen || midOpen){ mobileOpen = false; midOpen = false; applySide(); } }
window.addEventListener('resize', applySide);

/* ---------- events ---------- */
document.addEventListener('click', e => {
  if (e.target.closest('#modal') || e.target.closest('#cmd') || e.target.closest('#drawer')) return;
  if (menuEl){ if (menuEl.contains(e.target)) return; closeMenu(); }
  const t = e.target;
  if (t.closest('input.rename')) return;
  const m = t.closest('[data-menu]'); if (m){ e.stopPropagation(); openListMenu(m.dataset.menu, m); return; }
  const pm = t.closest('[data-pmenu]'); if (pm){ e.stopPropagation(); openPersonMenu(pm.dataset.pmenu, pm); return; }
  const nv = t.closest('[data-nav]'); if (nv){ setView(nv.dataset.nav); return; }
  if (t.closest('[data-sortrun]')){ openSortRun(); return; }
  const v = t.closest('[data-view]'); if (v){ setView(v.dataset.view); return; }
  // Today's day arrows: the plan for the working day before or after (the Day view).
  const dj = t.closest('[data-dayjump]'); if (dj){ setView('day'); stepDay(dj.dataset.dayjump === 'prev' ? -1 : 1); return; }
  // Today: a lens on Ranked (a rail goes back to List), the narrow-window Inbox, and the triage card's extras.
  const ln = t.closest('[data-lens]');
  if (ln){ if (ln.dataset.goto === 'inbox'){ setView('triage'); return; } setLens(ln.dataset.lens); return; }
  // Plan week on and off (views.js rankCol); from a rail or "Sort now", back to the Inbox.
  const pw = t.closest('[data-planweek]');
  if (pw){ if (pw.dataset.goto === 'inbox'){ setView('triage'); return; } setPlanWeek(pw.dataset.planweek === 'on'); return; }
  if (t.closest('[data-staleonly]')){ toggleStaleOnly(); return; }
  const qv = t.closest('[data-qv]'); if (qv){ quickSort(qv.closest('[data-id]').dataset.id, +qv.dataset.qv); return; }
  if (t.closest('[data-inbox-anyway]')){ openInboxAnyway(); focusCol('inbox'); return; }
  const lft = t.closest('[data-leftoff]'); if (lft){ leftOffClick(lft); return; }
  if (t.closest('[data-inbox-toggle]')){ setInboxOpen(!inboxOpen); render(); if (inboxOpen) focusCol('inbox'); return; }
  const sc = t.closest('[data-scope]'); if (sc){ setScope(sc.dataset.scope); return; }
  if (t.closest('[data-scopemenu]')){ openScopeMenu(t.closest('[data-scopemenu]')); return; }
  if (t.closest('#collapseBtn')){ toggleCollapse(); return; }
  if (t.closest('#menuBtn')){ mobileOpen = true; applySide(); const f = $('#snav .sitem'); if (f) f.focus(); return; }
  if (t.closest('#scrim')){ closeSide(); return; }
  if (t.closest('#dscrim')){ closeDrawer(); return; }
  if (t.closest('#addList')){ if (isWaiting()) return; askText('New list', '', name => { const n = {id: uid(), name, parentId: null}; state.lists.push(n); state.scope = n.id; commit(); }, 'Create'); return; }
  if (t.closest('#syncBtn')){ onSyncClick(t.closest('#syncBtn')); return; }
  if (t.closest('#adoBtn')){ onAdoClick(t.closest('#adoBtn')); return; }
  if (t.closest('#setBtn')){ openSettingsMenu(t.closest('#setBtn')); return; }
  if (t.closest('#themeBtn')){ openThemeMenu(t.closest('#themeBtn')); return; }
  if (t.closest('[data-add]')){ openCmd(); return; }
  if (t.closest('[data-suggest]')){ suggestPreview(); return; }
  const chk = t.closest('[data-act="done"]'); if (chk){ toggleDone(chk.closest('[data-id]').dataset.id); return; }
  const st = t.closest('[data-act="start"]'); if (st){ toggleStart(st.closest('[data-id]').dataset.id); return; }
  const nw = t.closest('[data-now]');
  if (nw){
    const a = nw.dataset.now, cur = activeTask();
    if (a === 'open' && cur) openDrawer(cur.id);
    if (a === 'pause') pauseTask();
    if (a === 'done' && cur) toggleDone(cur.id);
    if (a === 'interrupt') logInterrupt();
    if (a === 'crumb' && cur) askCrumb(cur.id, 'Leave a breadcrumb');
    if (a === 'startnext') startNext();
    if (a === 'opennext') openDrawer(nw.dataset.id);
    return;
  }
  if (t.closest('[data-shutdown]')){ openShutdown(); return; }
  const fb = t.closest('[data-act="today"]'); if (fb){ toggleFocus(fb.closest('[data-id]').dataset.id); return; }
  const as = t.closest('[data-act="assign"]'); if (as){ openAssign(as.closest('[data-id]').dataset.id, as); return; }
  const ng = t.closest('[data-act="nudged"]'); if (ng){ nudgedTask(ng.closest('[data-id]').dataset.id); return; }
  const gb = t.closest('[data-act="gotback"]'); if (gb){ gotBackTask(gb.closest('[data-id]').dataset.id); return; }
  const db = t.closest('[data-act="dismissback"]'); if (db){ dismissBack(db.closest('[data-id]').dataset.id); return; }
  const su = t.closest('[data-act="still"]'); if (su){ downgradeUrgent(su.closest('[data-id]').dataset.id); return; }
  const ec = t.closest('[data-act="eng"]'); if (ec){ engOpen(ec.dataset.ado); return; }
  const pa = t.closest('[data-act="prai"]'); if (pa){ const x = findTask(pa.closest('[data-id]').dataset.id); if (x && x.pr) prAiOpen(x); return; }
  const lo = t.closest('[data-left]'); if (lo){ carryLeft(lo.dataset.left === 'carry'); return; }
  const pf = t.closest('[data-pfilter]'); if (pf){ setPeopleFilter(pf.dataset.pfilter); return; }
  const nd = t.closest('[data-need]'); if (nd){ openNeed(nd.dataset.need); return; }
  const dp = t.closest('[data-dir-person]');
  if (dp){ const id = dp.dataset.dirPerson; askText(`Add a task for ${nameOf(id)}`, '', v => addTask(v, {who: [id]}), 'Add'); return; }
  if (t.closest('[data-addperson]')){
    askText('Add a person', '', n => addPerson(n).then(it => { if (it) toast(`${it.name} is @${it.handle}. Type that in any task.`); }), 'Add');
    return;
  }
  const wk = t.closest('[data-week]'); if (wk){ if (!wk.disabled){ setWeekOff(Math.min(0, weekOff + +wk.dataset.week)); render(); } return; }
  if (t.closest('[data-copy-recap]')){ copyText(recapText(recapData())); return; }
  const qa = t.closest('[data-qadd]'); if (qa){ setOpenQuad(openQuad === qa.dataset.qadd ? null : qa.dataset.qadd); render(); return; }
  if (t.closest('[data-clear-archive]')){
    const ids = scopeListIds();
    const n = state.tasks.filter(x => x.done && ids.includes(x.listId)).length;
    confirmBox('Clear done tasks?', `This permanently deletes ${plural(n,'finished task')} in this scope, including won't do.`, 'Clear', () => {
      state.tasks = state.tasks.filter(x => !(x.done && ids.includes(x.listId))); commit();
    });
    return;
  }
  if (t.closest('a.sig[href]')) return;   // the ADO chip on a row opens the item, not the drawer
  // Any task, the Inbox's included, opens in the drawer (the Inbox's tasks with their sort buttons on top).
  const ir = t.closest('.col-inbox .inrows .row[data-id]'); if (ir) setCol('inbox');
  const r = t.closest('.row[data-id]'); if (r && !t.closest('.qform,.pform')){ openDrawer(r.dataset.id); return; }
});
document.addEventListener('toggle', e => { if (e.target.id === 'doneGrp') setDoneOpen(e.target.open); if (e.target.id === 'revLine') setReviewsOpen(e.target.open); }, true);
// The column you work in on Today: where triage keys go, and where Left and Right move from.
const colOf = el => el && el.closest && el.closest('main .col[data-col]');
document.addEventListener('mousedown', e => { const c = colOf(e.target); if (c && c.dataset.col !== col) setCol(c.dataset.col); }, true);
document.addEventListener('change', e => {
  if (e.target.id === 'importFile'){ const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); }
  if (e.target.id === 'capIn'){ const n = Math.round(+e.target.value); if (n >= 1){ state.capacity = Math.min(999, n); } commit(); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'ptrayQ') setTrayQ(e.target.value);
});
document.addEventListener('submit', e => {
  const pf = e.target.closest && e.target.closest('.pform');
  if (pf){
    e.preventDefault();
    const p = pf.dataset.person;
    if (addTask(pf.querySelector('input').value, {who: [p], ado: takePasted(pf.querySelector('input'))})){
      const again = [...document.querySelectorAll('.pform')].find(x => x.dataset.person === p);
      if (again) again.querySelector('input').focus();
    }
    return;
  }
  const f = e.target.closest && e.target.closest('.qform'); if (!f) return;
  e.preventDefault();
  addTask(f.querySelector('input').value, {quad: {zone: f.dataset.qform, kind: state.lens}, ado: takePasted(f.querySelector('input'))});
});
document.addEventListener('focusout', e => {
  const f = e.target.closest && e.target.closest('.qform');
  if (!f || f.querySelector('input').value.trim()) return;
  setTimeout(() => {
    if (!document.activeElement || !document.activeElement.closest('.qform')){ setOpenQuad(null); render(); }
  }, 150);
});
document.addEventListener('focusin', e => {
  const r = e.target.closest && e.target.closest('main .row[data-id]');
  if (r && sel !== r.dataset.id){ setSel(r.dataset.id); markSel(); }
  const c = colOf(e.target); if (c && c.dataset.col !== col) setCol(c.dataset.col);
});
document.addEventListener('keydown', e => {
  const ae = document.activeElement || document.body;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable;
  const modalOpen = modal.classList.contains('open');
  if (e.key === 'Tab'){
    const trap = modalOpen ? modal.querySelector('.sheet') : cmdOpen() ? cmd.querySelector('.box') : drawerOverlay() ? drawer : (innerWidth < 760 && mobileOpen) ? $('#side') : null;
    if (trap) trapTab(e, trap);
    return;
  }
  if (!EMBEDDED && (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k'){ e.preventDefault(); if (modalOpen) return; cmdOpen() ? closeCmd() : openCmd(); return; }
  if (e.key === 'Escape'){
    if (cmdOpen()) return closeCmd();
    if (modalOpen) return closeModal();
    if (menuEl) return closeMenu(true);
    if (openQuad){ setOpenQuad(null); render(); return; }
    if (innerWidth < 760 && mobileOpen){ closeSide(); return; }
    if (drawerId) return closeDrawer();
    if (typing){ ae.blur(); return; }
    if (closeNeed()) return;
    if (state.view === 'today' && (col || inboxOpen)){ setCol(null); if (inboxOpen){ setInboxOpen(false); render(); } if (ae && ae.blur) ae.blur(); return; }
    return;
  }
  if (menuEl && (e.key === 'ArrowDown' || e.key === 'ArrowUp')){
    const items = [...menuEl.querySelectorAll('button')], i = items.indexOf(ae);
    e.preventDefault(); (items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length] || items[0]).focus(); return;
  }
  if (typing || modalOpen || cmdOpen()) return;
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')){
    if (sel){ e.preventDefault(); if (moveTask(sel, e.key === 'ArrowUp' ? 'up' : 'down')) requestAnimationFrame(focusSel); }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const onButton = ae.tagName === 'BUTTON' || ae.tagName === 'A' || (ae.getAttribute && ae.getAttribute('role') === 'button');
  // In Today's Inbox column, Triage's keys set the card (value 1-4, effort Q-T, Enter saves).
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  // A row in the Inbox: 1 to 4 sort it by value, 0 is won't do, Enter opens its card (views.js sortKey).
  const inboxRow = state.view === 'today' && sel && main.querySelector(`.col-inbox .row[data-id="${CSS.escape(sel)}"]`);
  if (inboxRow && /^[0-4]$/.test(k)){
    e.preventDefault();
    const next = sortKey(sel, k);
    if (typeof next === 'string'){ setSel(next); setCol('inbox'); requestAnimationFrame(focusSel); }
    return;
  }
  if (inboxRow && k === 'Enter' && !onButton){ e.preventDefault(); setCol('inbox'); openDrawer(sel); return; }
  if (k === 'n' || k === '/'){ e.preventDefault(); openCmd(); }
  else if (k === 'o' && state.view === 'today' && !planWeek()){ e.preventDefault(); openSortRun(); }
  else if (k === '4' && state.view === 'today'){ setPlanWeek(!planWeek()); }
  else if (/^[1-6]$/.test(k)){ setView(NAV_KEYS[k]); }
  else if ((k === 'ArrowLeft' || k === 'ArrowRight') && state.view === 'today'){
    const cols = [...main.querySelectorAll('.col[data-col]:not(.rail)')].map(c => c.dataset.col); if (!cols.length) return;
    const i = cols.indexOf(col), j = i < 0 ? (k === 'ArrowLeft' ? 0 : cols.length - 1) : Math.max(0, Math.min(cols.length - 1, i + (k === 'ArrowLeft' ? -1 : 1)));
    e.preventDefault(); focusCol(cols[j]);
  }
  else if (k === 'j' || k === 'ArrowDown' && ae.classList && ae.classList.contains('row')){ e.preventDefault(); moveSel(1); }
  else if (k === 'k' || k === 'ArrowUp' && ae.classList && ae.classList.contains('row')){ e.preventDefault(); moveSel(-1); }
  else if (k === 'Enter' && !onButton){
    if (ae.dataset && ae.dataset.scope){ setScope(ae.dataset.scope); return; }
    const id = (ae.classList && ae.classList.contains('row')) ? ae.dataset.id : sel;
    if (id){ e.preventDefault(); openDrawer(id); }
  }
  else if (k === ' ' && ae.dataset && ae.dataset.scope){ e.preventDefault(); setScope(ae.dataset.scope); }
  else if (k === 'x' && sel){ toggleDone(sel); requestAnimationFrame(focusSel); }
  else if (k === 't' && sel){ toggleFocus(sel); requestAnimationFrame(focusSel); }
  else if (k === 'a' && sel){ e.preventDefault(); openAssign(sel, main.querySelector(`.row[data-id="${CSS.escape(sel)}"] .twho`) || main.querySelector(`.row[data-id="${CSS.escape(sel)}"]`)); }
  else if (k === 'w' && sel){ e.preventDefault(); toggleWaiting(sel); requestAnimationFrame(focusSel); }
  else if (k === 's' && (sel || activeTask())){ e.preventDefault(); toggleStart(sel || activeTask().id); }
  else if (k === 's'){ e.preventDefault(); startNext(); }
  else if (k === 'i'){ e.preventDefault(); logInterrupt(); }
  else if (k === 'l' && sel){ e.preventDefault(); copyTaskLink(findTask(sel)); }
  else if (k === '?'){ showHelp(); }
});
let lastDay = todayStr();
const checkDay = () => { if (todayStr() !== lastDay){ lastDay = todayStr(); render(); } };
setInterval(checkDay, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDay(); });

/* ---------- the Android Back button (native.js) ----------
   Closes what is on top, like Esc: the add bar, a dialog, a menu, the sidebar, a task's details. With
   nothing open it steps back to Today. Returns false on Today with nothing open, so the app goes to the
   background, as Back does on any Android app's first screen. */
function backStep(){
  const ae = document.activeElement;
  if (cmdOpen()){ closeCmd(); return true; }
  if (modal.classList.contains('open')){ closeModal(); return true; }
  if (menuEl){ closeMenu(true); return true; }
  if (openQuad){ setOpenQuad(null); render(); return true; }
  if (mobileOpen || midOpen){ closeSide(); return true; }
  if (drawerId){ closeDrawer(); return true; }
  if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) ae.blur();
  if (state.view === 'today' && inboxOpen){ setInboxOpen(false); render(); return true; }
  if (state.view !== 'today'){ setView('today'); return true; }
  return false;
}

/* ---------- tooltips ---------- */
const tipEl = $('#tip');
let tipFor = null, tipTimer = null;
function placeTip(el){
  tipEl.textContent = el.dataset.tip;
  const r = el.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8));
  let top = r.bottom + 8; if (top + h > innerHeight - 8) top = r.top - h - 8;
  if (el.closest('.side') && !el.closest('.slists')){ left = Math.min(r.right + 8, innerWidth - w - 8); top = r.top + r.height / 2 - h / 2; }
  tipEl.style.left = left + 'px'; tipEl.style.top = top + 'px';
}
function hideTip(){ clearTimeout(tipTimer); tipEl.classList.remove('show'); tipFor = null; }
const HOVER = typeof matchMedia !== 'function' || !matchMedia('(hover: none)').matches; // no tooltips on touch screens
document.addEventListener('mouseover', e => {
  if (!HOVER) return;
  const el = e.target.closest && e.target.closest('[data-tip]');
  if (el === tipFor) return;
  hideTip(); if (!el) return;
  if (el.closest('.sitem') && !app.classList.contains('collapsed') && el.classList.contains('sitem')) return; // labels already visible
  tipFor = el;
  tipTimer = setTimeout(() => { if (tipFor === el && el.isConnected){ placeTip(el); tipEl.classList.add('show'); } }, 320);
});
['mousedown','dragstart','scroll','keydown'].forEach(ev => document.addEventListener(ev, hideTip, true));

/* Settings (Docket 9.0.0): one button at the foot of the sidebar for everything that sets Docket up. Saving and ADO
   keep their own icons beside it, since those also show when something needs you. */
function openSettingsMenu(anchor){
  popMenu(`<div class="mhead">Settings</div><button data-set="day">Day and sprint</button><button data-set="rows">Row fields</button>`
    + `<button data-set="ado">Azure DevOps</button><button data-set="files">Files and backups</button>`, anchor)
    .addEventListener('click', e => {
      const b = e.target.closest('[data-set]'); if (!b) return;
      closeMenu();
      const k = b.dataset.set;
      if (k === 'day') daySettings();
      if (k === 'rows') openDisplay();
      if (k === 'ado') adoSetup();
      if (k === 'files') onSyncClick($('#syncBtn') || anchor);
    });
}

export { applySide, backStep, closeSide, hideTip, placeTip, tipFor };

/* Today's width (Docket 9.1.0): drag the Today column's left edge, or use the arrow keys on it; double-click resets.
   The width is kept per browser (ui.todayW) and capped so To sort and Up next keep room. */
const TW_MIN = 320;
function twMax(grid){ return Math.max(TW_MIN, grid.clientWidth - 580); }   // To sort and Up next keep their 15rem and 17rem
function setTodayW(grid, w){
  if (w == null){ delete ui.todayW; grid.style.removeProperty('--tw'); }
  else { ui.todayW = Math.round(Math.max(TW_MIN, Math.min(twMax(grid), w))); grid.style.setProperty('--tw', ui.todayW + 'px'); }
}
document.addEventListener('pointerdown', e => {
  const g = e.target.closest('.t3grip'); if (!g || e.button !== 0) return;
  const col = g.closest('.col-today'), grid = g.closest('.today3'); if (!col || !grid) return;
  e.preventDefault();
  const right = col.getBoundingClientRect().right;
  grid.classList.add('resizing');
  const move = ev => setTodayW(grid, right - ev.clientX);
  const up = () => { grid.classList.remove('resizing'); removeEventListener('pointermove', move); removeEventListener('pointerup', up); saveUi(); };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
});
document.addEventListener('dblclick', e => {
  const g = e.target.closest('.t3grip'); if (!g) return;
  setTodayW(g.closest('.today3'), null); saveUi();
});
document.addEventListener('keydown', e => {
  const g = e.target.closest && e.target.closest('.t3grip'); if (!g || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
  e.preventDefault(); e.stopPropagation();
  const col = g.closest('.col-today'), grid = g.closest('.today3');
  setTodayW(grid, col.getBoundingClientRect().width + (e.key === 'ArrowLeft' ? 40 : -40)); saveUi();
}, true);

