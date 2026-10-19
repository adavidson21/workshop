import { applyOrder, dropIntoQuadrant } from './actions.js';
import { hideTip } from './events.js';
import { toast } from './overlays.js';
import { render } from './render.js';
import { commit, findTask, listById, state } from './state.js';
import { todayStr } from './util.js';
/* Prioritizer: Drag and drop between lists, quadrants and people, plus inline rename. */
/* ---------- drag and drop (desktop) ---------- */
let dragId = null, dragFromPerson = null, overEl = null;
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
  if (zone === 'rank'){
    if (state.view === 'today' && t.focusOn !== todayStr()){ t.focusOn = todayStr(); commit(); return; }
    applyOrder([...z.querySelectorAll(':scope > .row')].map(n => n.dataset.id)); return;
  }
  if (zone === 'unfocus'){ if (t.focusOn === todayStr()){ t.focusOn = null; commit(); } else render(); return; }
  if (zone === 'person'){
    const p = z.dataset.person;
    if (from === p) return render();
    if (from) t.people = t.people.filter(x => x !== from); // dragged between people: move it
    if (!t.people.includes(p)) t.people.push(p);
    commit(); return;
  }
  if (state.view === 'eisen' || state.view === 've') return dropIntoQuadrant(t, zone, state.view);
  render();
});
document.addEventListener('dragend', () => {
  clearOver(); dragFromPerson = null;
  if (dragId){ dragId = null; render(); } // drag was cancelled: restore order
});

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
