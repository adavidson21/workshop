import { applyOrder, dropIntoQuadrant } from './actions.js';
import { hideTip } from './events.js';
import { toast } from './overlays.js';
import { render } from './render.js';
import { commit, findTask, listById, state } from './state.js';
import { todayStr } from './util.js';
import { dayDrop } from './day-view.js';
import { dropDelegate } from './delegate.js';
/* Prioritizer: Drag and drop between lists, quadrants and people (the People view's Unassigned tray delegates),
   plus inline rename. */
/* ---------- drag and drop (desktop) ---------- */
let dragId = null, dragFromPerson = null, overEl = null, lastTouch = 0;
function setOver(el){
  if (overEl === el) return;
  clearOver(); overEl = el;
  if (el) el.classList.add(el.dataset.droplist ? 'drop-target' : 'drop-over');
}
function clearOver(){ if (overEl){ overEl.classList.remove('drop-over','drop-target'); overEl = null; } }
function getAfter(container, y){
  let best = {off: -Infinity, el: null};
  container.querySelectorAll(':scope > .row:not(.dragging)').forEach(el => {
    const b = el.getBoundingClientRect(), off = y - b.top - b.height / 2;
    if (off < 0 && off > best.off) best = {off, el};
  });
  return best.el;
}
document.addEventListener('dragstart', e => {
  // A long press on a phone may start the browser's own drag: touch uses the press-and-hold drag below.
  if (Date.now() - lastTouch < 1500){ e.preventDefault(); return; }
  const n = e.target.closest && e.target.closest('.row[data-id]'); if (!n) return;
  dragId = n.dataset.id;
  const pc = n.closest('.pcard'); dragFromPerson = pc ? pc.dataset.person : null;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', dragId); } catch(_) {}
  hideTip();
  setTimeout(() => n.classList.add('dragging'), 0);
});
document.addEventListener('dragover', e => {
  if (!dragId) return;
  const z = e.target.closest && e.target.closest('.dropzone,[data-droplist]');
  if (!z){ clearOver(); return; }
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  if (z.dataset.zone === 'rank'){
    const el = z.querySelector(':scope > .row.dragging');
    if (!el){ setOver(z); return; } // coming from another panel
    clearOver();
    const after = getAfter(z, e.clientY);
    if (after == null){ const rows = z.querySelectorAll(':scope > .row'); const last = rows[rows.length - 1]; if (last !== el) last.after(el); }
    else if (after !== el && after.previousElementSibling !== el) z.insertBefore(el, after);
    z.querySelectorAll(':scope > .row .rank').forEach((s,i) => s.textContent = i + 1);
  } else setOver(z);
});
document.addEventListener('drop', e => {
  if (!dragId) return;
  const z = e.target.closest && e.target.closest('.dropzone,[data-droplist]');
  if (!z) return;
  e.preventDefault();
  const id = dragId; dragId = null; clearOver();
  const t = findTask(id); if (!t) return render();
  if (z.dataset.droplist){
    const L = listById(z.dataset.droplist);
    if (L && t.listId !== L.id){ const was = t.listId; t.listId = L.id; commit(); toast(`Moved to ${L.name}`, 'Undo', () => { t.listId = was; commit(); }); } else render();
    return;
  }
  const zone = z.dataset.zone, from = dragFromPerson; dragFromPerson = null;
  if (zone === 'dsec' || zone === 'dtray') return dayDrop(id, z, e.clientY); // the Day view's blocks and tray
  if (zone === 'rank'){
    if (state.view === 'today' && t.focusOn !== todayStr()){ t.focusOn = todayStr(); commit(); return; }
    applyOrder([...z.querySelectorAll(':scope > .row')].map(n => n.dataset.id)); return;
  }
  if (zone === 'untray'){                          // off a person's card into Unassigned: take them off
    if (!from || !t.who.includes(from)) return render();
    const before = {who: [...t.who], waiting: t.waiting, nudgeOn: t.nudgeOn};
    t.who = t.who.filter(x => x !== from);
    if (!t.who.length && t.waiting){ t.waiting = false; t.nudgeOn = null; }
    commit();
    toast(t.who.length ? 'Took them off' : 'Unassigned', 'Undo', () => { Object.assign(t, before); commit(); });
    return;
  }
  if (zone === 'unfocus'){ if (t.focusOn === todayStr()){ t.focusOn = null; commit(); } else render(); return; }
  if (zone === 'person'){
    const p = z.dataset.person;
    if (from === p) return render();
    if (!from) return dropDelegate(t, p);              // from the Unassigned tray (or another view): delegate it
    t.who = t.who.filter(x => x !== from);            // dragged between people: move it, waiting or not
    if (!t.who.includes(p)) t.who.push(p);
    commit(); return;
  }
  if (state.view === 'eisen' || state.view === 've') return dropIntoQuadrant(t, zone, state.view);
  render();
});
document.addEventListener('dragend', () => {
  clearOver(); dragFromPerson = null;
  if (dragId){ dragId = null; render(); } // drag was cancelled: restore order
});

/* ---------- touch: press and hold a task, then drag it to reorder ----------
   HTML drag and drop never starts from a finger, so on touch screens a row in a ranked list (Prioritize's
   List, and Today's list) lifts after a short press and follows the finger; letting go saves the order.
   Moving the finger before the press completes is a scroll, as usual. Other moves (to a list, a person, a
   quadrant, Today) are in the task's details on touch. */
const HOLD_MS = 380, SLOP = 10, EDGE = 72, MAX_SCROLL = 14;
let tdrag = null, eatClick = 0;
const rowsOf = (zone, except) => [...zone.querySelectorAll(':scope > .row[data-id]')].filter(r => r !== except);
document.addEventListener('touchstart', e => {
  lastTouch = Date.now();
  if (tdrag || e.touches.length !== 1) return;
  const t = e.target, row = t.closest && t.closest('.row[data-id]');
  if (!row || t.closest('button, input, select, textarea, a') || row.classList.contains('done')) return;
  const zone = row.parentElement;
  if (!zone || !zone.matches('[data-zone="rank"]') || rowsOf(zone, row).length === 0) return;
  const {clientX: x, clientY: y} = e.touches[0];
  tdrag = {row, zone, x, y, lastY: y, active: false, raf: 0, order: rowsOf(zone).map(r => r.dataset.id).join()};
  tdrag.timer = setTimeout(lift, HOLD_MS);
}, {passive: true});
function lift(){
  if (!tdrag) return;
  tdrag.active = true;
  hideTip();
  tdrag.row.classList.add('lifted');
  document.body.classList.add('touch-dragging');
  if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) { /* not allowed */ }
  tdrag.scroller = tdrag.row.closest('main');
  const step = () => {
    if (!tdrag || !tdrag.active) return;
    const s = tdrag.scroller;
    if (s){
      const r = s.getBoundingClientRect(), y = tdrag.lastY;
      const dy = y < r.top + EDGE ? -Math.ceil((r.top + EDGE - y) / EDGE * MAX_SCROLL) : y > r.bottom - EDGE ? Math.ceil((y - r.bottom + EDGE) / EDGE * MAX_SCROLL) : 0;
      if (dy){ s.scrollTop += dy; place(y); }
    }
    tdrag.raf = requestAnimationFrame(step);
  };
  tdrag.raf = requestAnimationFrame(step);
}
// Put the lifted row where the finger is, among the other rows of its list.
function place(y){
  const {row, zone} = tdrag;
  const after = rowsOf(zone, row).find(el => { const b = el.getBoundingClientRect(); return y < b.top + b.height / 2; });
  if (after){ if (after.previousElementSibling !== row) zone.insertBefore(row, after); }
  else { const rows = rowsOf(zone, row), last = rows[rows.length - 1]; if (last && last.nextElementSibling !== row) last.after(row); }
  zone.querySelectorAll(':scope > .row .rank').forEach((s, i) => s.textContent = i + 1);
}
document.addEventListener('touchmove', e => {
  if (!tdrag) return;
  const {clientX: x, clientY: y} = e.touches[0];
  if (!tdrag.active){
    if (Math.abs(x - tdrag.x) > SLOP || Math.abs(y - tdrag.y) > SLOP){ clearTimeout(tdrag.timer); tdrag = null; } // a scroll
    return;
  }
  e.preventDefault(); // the page does not scroll while a task is lifted
  tdrag.lastY = y;
  place(y);
}, {passive: false});
function drop(cancelled){
  if (!tdrag) return;
  const d = tdrag; tdrag = null;
  clearTimeout(d.timer);
  if (!d.active) return;
  cancelAnimationFrame(d.raf);
  d.row.classList.remove('lifted');
  document.body.classList.remove('touch-dragging');
  eatClick = Date.now(); // the press that lifted the row is not also a tap that opens it
  const ids = rowsOf(d.zone).map(r => r.dataset.id);
  if (cancelled || ids.join() === d.order) return render();
  applyOrder(ids);
}
document.addEventListener('touchend', () => drop(false));
document.addEventListener('touchcancel', () => drop(true));
document.addEventListener('contextmenu', e => { if (tdrag) e.preventDefault(); }); // a long press, not a menu
document.addEventListener('click', e => { if (Date.now() - eatClick < 450){ e.preventDefault(); e.stopPropagation(); eatClick = 0; } }, true);

/* ---------- inline rename ---------- */
function inlineEdit(span, value, label, onSave){
  hideTip();
  const inp = document.createElement('input');
  inp.className = 'rename'; inp.value = value; inp.maxLength = 60; inp.setAttribute('aria-label', label);
  let done = false;
  const finish = keep => {
    if (done) return; done = true;
    const v = inp.value.trim();
    if (keep && v && v !== value) onSave(v); else render();
  };
  inp.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter'){ e.preventDefault(); finish(true); }
    else if (e.key === 'Escape'){ e.preventDefault(); finish(false); }
  });
  inp.addEventListener('click', e => e.stopPropagation());
  inp.addEventListener('blur', () => finish(true));
  span.replaceWith(inp);
  inp.focus(); inp.select();
}

export { inlineEdit };
