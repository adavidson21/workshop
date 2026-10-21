import { addTask, downgradeUrgent, moveTask, toggleDone, toggleFocus } from './actions.js';
import { onAdoClick } from './ado.js';
import { closeCmd, cmd, cmdOpen, openCmd } from './command-bar.js';
import { EMBEDDED } from './constants.js';
import { closeDrawer, drawerId, drawerOverlay, focusSel, markSel, moveSel, openDrawer } from './drawer.js';
import { engOpen } from './eng.js';
import { askText, closeMenu, closeModal, confirmBox, menuEl, modal, openListMenu, openScopeMenu, openThemeMenu, showHelp, suggestPreview, trapTab } from './overlays.js';
import { openPersonMenu } from './people.js';
import { app, drawer, openQuad, render, sel, setDoneOpen, setOpenQuad, setScope, setSel, setShowAllPick, setView, setWeekOff, showAllPick, tri, weekOff } from './render.js';
import { canonPerson, commit, inScope, saveUi, scopeListIds, state, ui } from './state.js';
import { importFile, onSyncClick } from './storage.js';
import { $, isDate, plural, todayStr, uid } from './util.js';
import { copyText, exitTriage, recapData, recapText, renderTriage, triageKey, triageSave, triageSkip, triageWont } from './views.js';
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
  const nv = t.closest('[data-nav]'); if (nv){ setView(nv.dataset.nav === 'prio' ? state.lens : nv.dataset.nav); return; }
  const v = t.closest('[data-view]'); if (v){ setView(v.dataset.view); return; }
  const sc = t.closest('[data-scope]'); if (sc){ setScope(sc.dataset.scope); return; }
  if (t.closest('[data-scopemenu]')){ openScopeMenu(t.closest('[data-scopemenu]')); return; }
  if (t.closest('#collapseBtn')){ toggleCollapse(); return; }
  if (t.closest('#menuBtn')){ mobileOpen = true; applySide(); const f = $('#snav .sitem'); if (f) f.focus(); return; }
  if (t.closest('#scrim')){ closeSide(); return; }
  if (t.closest('#dscrim')){ closeDrawer(); return; }
  if (t.closest('#addList')){ askText('New list', '', name => { const n = {id: uid(), name, parentId: null}; state.lists.push(n); state.scope = n.id; commit(); }, 'Create'); return; }
  if (t.closest('#syncBtn')){ onSyncClick(t.closest('#syncBtn')); return; }
  if (t.closest('#adoBtn')){ onAdoClick(t.closest('#adoBtn')); return; }
  if (t.closest('#themeBtn')){ openThemeMenu(t.closest('#themeBtn')); return; }
  if (t.closest('#helpBtn')){ showHelp(); return; }
  if (t.closest('[data-add]')){ openCmd(); return; }
  if (t.closest('[data-suggest]')){ suggestPreview(); return; }
  const tv = t.closest('[data-tv]'); if (tv && tri.draft){ const n = +tv.dataset.tv; tri.draft.value = tri.draft.value === n ? null : n; renderTriage(); return; }
  const te = t.closest('[data-te]'); if (te && tri.draft){ tri.draft.effort = tri.draft.effort === te.dataset.te ? null : te.dataset.te; renderTriage(); return; }
  const tt = t.closest('[data-tt]'); if (tt && tri.draft){ tri.draft[tt.dataset.tt] = !tri.draft[tt.dataset.tt]; renderTriage(); return; }
  if (t.closest('[data-tdue-clear]') && tri.draft){ tri.draft.due = null; renderTriage(); return; }
  const ta = t.closest('[data-tact]'); if (ta){ ({save: triageSave, skip: triageSkip, wont: triageWont})[ta.dataset.tact](); return; }
  const chk = t.closest('[data-act="done"]'); if (chk){ toggleDone(chk.closest('[data-id]').dataset.id); return; }
  const fb = t.closest('[data-act="today"]'); if (fb){ toggleFocus(fb.closest('[data-id]').dataset.id); return; }
  const su = t.closest('[data-act="still"]'); if (su){ downgradeUrgent(su.closest('[data-id]').dataset.id); return; }
  const ec = t.closest('[data-act="eng"]'); if (ec){ engOpen(ec.dataset.ado); return; }
  const lo = t.closest('[data-left]');
  if (lo){
    const t0 = todayStr();
    state.tasks.forEach(x => { if (inScope(x) && !x.done && x.focusOn && x.focusOn < t0) x.focusOn = lo.dataset.left === 'carry' ? t0 : null; });
    commit(); return;
  }
  if (t.closest('[data-pickall]')){ setShowAllPick(!showAllPick); render(); return; }
  if (t.closest('[data-addperson]')){ askText('Add a person', '', n => { canonPerson(n); commit(); }, 'Add'); return; }
  const wk = t.closest('[data-week]'); if (wk){ if (!wk.disabled){ setWeekOff(Math.min(0, weekOff + +wk.dataset.week)); render(); } return; }
  if (t.closest('[data-copy-recap]')){ copyText(recapText(recapData())); return; }
  const qa = t.closest('[data-qadd]'); if (qa){ setOpenQuad(openQuad === qa.dataset.qadd ? null : qa.dataset.qadd); render(); return; }
  if (t.closest('[data-clear-archive]')){
    const ids = scopeListIds();
    const n = state.tasks.filter(x => x.done && ids.includes(x.listId)).length;
    confirmBox('Clear archive?', `This permanently deletes ${plural(n,'finished task')} in this scope, including won't do.`, 'Clear', () => {
      state.tasks = state.tasks.filter(x => !(x.done && ids.includes(x.listId))); commit();
    });
    return;
  }
  const r = t.closest('.row[data-id]'); if (r && !t.closest('.qform,.pform')){ openDrawer(r.dataset.id); return; }
});
document.addEventListener('toggle', e => { if (e.target.id === 'doneGrp') setDoneOpen(e.target.open); }, true);
document.addEventListener('change', e => {
  if (e.target.id === 'importFile'){ const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); }
  if (e.target.id === 'capIn'){ const n = Math.round(+e.target.value); if (n >= 1){ state.capacity = Math.min(999, n); } commit(); }
  if (e.target.id === 'triDue' && tri.draft){ tri.draft.due = isDate(e.target.value) ? e.target.value : null; renderTriage(); }
});
document.addEventListener('submit', e => {
  const pf = e.target.closest && e.target.closest('.pform');
  if (pf){
    e.preventDefault();
    const p = pf.dataset.person;
    if (addTask(pf.querySelector('input').value, {people: [p]})){
      const again = [...document.querySelectorAll('.pform')].find(x => x.dataset.person === p);
      if (again) again.querySelector('input').focus();
    }
    return;
  }
  const f = e.target.closest && e.target.closest('.qform'); if (!f) return;
  e.preventDefault();
  addTask(f.querySelector('input').value, {quad: {zone: f.dataset.qform, kind: state.view}});
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
    if (ae.id === 'triDue'){ ae.blur(); return; }
    if (innerWidth < 760 && mobileOpen){ closeSide(); return; }
    if (drawerId) return closeDrawer();
    if (typing){ ae.blur(); return; }
    if (state.view === 'triage') return exitTriage();
    return;
  }
  if (ae.id === 'triDue' && e.key === 'Enter' && tri.draft){ e.preventDefault(); tri.draft.due = isDate(ae.value) ? ae.value : null; triageSave(); return; }
  if (menuEl && (e.key === 'ArrowDown' || e.key === 'ArrowUp')){
    const items = [...menuEl.querySelectorAll('button')], i = items.indexOf(ae);
    e.preventDefault(); (items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length] || items[0]).focus(); return;
  }
  if (typing || modalOpen || cmdOpen()) return;
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')){
    if (sel && state.view !== 'triage'){ e.preventDefault(); if (moveTask(sel, e.key === 'ArrowUp' ? 'up' : 'down')) requestAnimationFrame(focusSel); }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const onButton = ae.tagName === 'BUTTON' || ae.tagName === 'A' || (ae.getAttribute && ae.getAttribute('role') === 'button');
  if (state.view === 'triage' && !(onButton && (e.key === 'Enter' || e.key === ' ')) && triageKey(e)) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === 'n' || k === '/'){ e.preventDefault(); openCmd(); }
  else if (/^[1-6]$/.test(k)){ const nav = ['today','triage','prio','people','archive','reports'][+k - 1]; setView(nav === 'prio' ? state.lens : nav); }
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
  else if (k === '?'){ showHelp(); }
});
let lastDay = todayStr();
const checkDay = () => { if (todayStr() !== lastDay){ lastDay = todayStr(); render(); } };
setInterval(checkDay, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDay(); });

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
document.addEventListener('mouseover', e => {
  const el = e.target.closest && e.target.closest('[data-tip]');
  if (el === tipFor) return;
  hideTip(); if (!el) return;
  if (el.closest('.sitem') && !app.classList.contains('collapsed') && el.classList.contains('sitem')) return; // labels already visible
  tipFor = el;
  tipTimer = setTimeout(() => { if (tipFor === el && el.isConnected){ placeTip(el); tipEl.classList.add('show'); } }, 320);
});
['mousedown','dragstart','scroll','keydown'].forEach(ev => document.addEventListener(ev, hideTip, true));

export { applySide, closeSide, hideTip, placeTip, tipFor };
