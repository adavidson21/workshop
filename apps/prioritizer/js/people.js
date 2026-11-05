import { inlineEdit } from './drag-drop.js';
import { closeMenu, popMenu, toast } from './overlays.js';
import { render } from './render.js';
import { commit, findTask, state } from './state.js';
import { esc } from './util.js';
import { getDirectory, nameOf } from './directory-model.js';
import { ready } from './ws.js';
/* Docket: People view menus. People and groups live in Workshop's people directory (docs/people.md): renaming
   changes the name everywhere; "Take off these tasks" only changes this board. Members and handles are edited
   in Workshop's Settings, People. */

async function rename(id, name){
  name = String(name || '').replace(/^@/, '').trim();
  if (!name || name === nameOf(id)) return render();
  const ws = await ready;
  if (!ws) return render();
  try { await ws.people.update(id, {name}); }
  catch (e){ toast(`Couldn't rename: ${e.message || e}`); }
  render();
}

function takeOff(id){
  const hits = state.tasks.filter(t => t.who.includes(id)).map(t => t.id);
  state.tasks.forEach(t => { t.who = t.who.filter(x => x !== id); });
  commit();
  toast(`Took ${nameOf(id)} off ${hits.length} ${hits.length === 1 ? 'task' : 'tasks'}`, 'Undo', () => {
    hits.forEach(tid => { const t = findTask(tid); if (t && !t.who.includes(id)) t.who.push(id); });
    commit();
  });
}

function editName(id){
  const span = [...document.querySelectorAll('.pcard')].find(c => c.dataset.person === id)?.querySelector('.pname');
  if (span) inlineEdit(span, nameOf(id), 'Name', v => rename(id, v));
}

function openPersonMenu(id, anchor){
  const it = getDirectory().byId.get(id);
  const settings = '<button data-pm="settings">Edit in Settings</button>';
  popMenu(`${it ? '<button data-pm="rename">Rename</button>' : ''}${it && it.kind === 'group' ? settings : ''}<button data-pm="off" class="danger">Take ${esc(nameOf(id))} off these tasks</button>`, anchor, 'right')
    .addEventListener('click', async e => {
      const b = e.target.closest('[data-pm]'); if (!b) return;
      closeMenu();
      if (b.dataset.pm === 'off') return takeOff(id);
      if (b.dataset.pm === 'settings'){ const ws = await ready; if (ws && ws.embedded) ws.open({app: 'settings'}); else toast('Edit groups in Workshop: Settings, People.'); return; }
      editName(id);
    });
}
document.addEventListener('dblclick', e => {
  const span = e.target.closest && e.target.closest('.pname');
  if (span){ editName(span.closest('.pcard').dataset.person); return; }
  const li = e.target.closest && e.target.closest('[data-scope]:not([data-scope="all"])');
  if (li && !e.target.closest('[data-menu]')){
    const L = state.lists.find(l => l.id === li.dataset.scope), lbl = li.querySelector('.lbl');
    if (L && lbl) inlineEdit(lbl, L.name, 'List name', v => { L.name = v; commit(); });
  }
});

export { openPersonMenu };
