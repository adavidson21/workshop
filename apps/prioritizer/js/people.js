import { inlineEdit } from './drag-drop.js';
import { closeMenu, popMenu, toast } from './overlays.js';
import { render } from './render.js';
import { commit, findTask, listById, state } from './state.js';
import { esc } from './util.js';
/* Prioritizer: People: rename, remove, person menu. */
/* ---------- people ---------- */
function renamePerson(oldN, newN){
  newN = newN.replace(/^@/, '').trim(); if (!newN) return render();
  const clash = state.people.find(p => p !== oldN && p.toLowerCase() === newN.toLowerCase());
  const target = clash || newN;
  state.people = clash ? state.people.filter(p => p !== oldN) : state.people.map(p => p === oldN ? target : p);
  state.tasks.forEach(t => { if (t.people.includes(oldN)) t.people = [...new Set(t.people.map(p => p === oldN ? target : p))]; });
  commit();
  if (clash) toast(`Merged into ${clash}`);
}
function removePerson(n){
  const idx = state.people.indexOf(n);
  const hits = state.tasks.filter(t => t.people.includes(n)).map(t => t.id);
  state.people = state.people.filter(p => p !== n);
  state.tasks.forEach(t => { t.people = t.people.filter(p => p !== n); });
  commit();
  toast(`Removed ${n}`, 'Undo', () => {
    state.people.splice(Math.min(idx, state.people.length), 0, n);
    hits.forEach(id => { const t = findTask(id); if (t && !t.people.includes(n)) t.people.push(n); });
    commit();
  });
}
function openPersonMenu(n, anchor){
  popMenu(`<button data-pm="rename">Rename</button><button data-pm="remove" class="danger">Remove ${esc(n)}</button>`, anchor, 'right')
    .addEventListener('click', e => {
      const b = e.target.closest('[data-pm]'); if (!b) return;
      closeMenu();
      if (b.dataset.pm === 'remove') return removePerson(n);
      const span = [...document.querySelectorAll('.pcard')].find(c => c.dataset.person === n)?.querySelector('.pname');
      if (span) inlineEdit(span, n, 'Name', v => renamePerson(n, v));
    });
}
document.addEventListener('dblclick', e => {
  const span = e.target.closest && e.target.closest('.pname');
  if (span){ const n = span.closest('.pcard').dataset.person; inlineEdit(span, n, 'Name', v => renamePerson(n, v)); return; }
  const li = e.target.closest && e.target.closest('[data-scope]:not([data-scope="all"])');
  if (li && !e.target.closest('[data-menu]')){
    const L = listById(li.dataset.scope), lbl = li.querySelector('.lbl');
    if (L && lbl) inlineEdit(lbl, L.name, 'List name', v => { L.name = v; commit(); });
  }
});

export { openPersonMenu };
