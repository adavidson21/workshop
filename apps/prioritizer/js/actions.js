import { COLORS, EQ, POINTS, VQ } from './constants.js';
import { closeDrawer, drawerId, openDrawer } from './drawer.js';
import { urgency } from './model.js';
import { toast } from './overlays.js';
import { parseQuick } from './quick-add.js';
import { canonPerson, commit, defaultListId, findTask, isFocus, normalizeRanks, scopeOpen, state } from './state.js';
import { fmtDay, todayStr, uid } from './util.js';
/* Prioritizer: Task actions: add, complete, won't do, Today, delete, reorder, quadrant drops. */
/* ---------- task actions ---------- */
function addTask(text, attrs = {}){
  const p = parseQuick(text);
  if (!p.title) return null;
  const people = [...new Set([...(attrs.people || []), ...p.people].map(canonPerson).filter(Boolean))];
  const maxRank = state.tasks.reduce((m,t) => Math.max(m, t.rank), 0);
  const t = {
    id: uid(), title: p.title, notes: '', color: COLORS[state.colorIdx++ % COLORS.length], rank: maxRank + 1,
    value: p.value, effort: p.effort, due: p.due, urgentFlag: p.urgentFlag,
    listId: p.listId || attrs.listId || defaultListId(), done: false, doneAt: null, wontDo: false,
    createdAt: todayStr(), ageFrom: todayStr(), waiting: false, nudgeOn: null, focusOn: null
  };
  for (const k of ['focusOn','waiting']) if (k in attrs) t[k] = attrs[k];
  if (attrs.quad) applyDrop(t, attrs.quad.zone, attrs.quad.kind);
  t.people = people;
  state.tasks.push(t);
  commit();
  return t;
}
function toggleDone(id){
  const t = findTask(id); if (!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? todayStr() : null;
  if (!t.done) t.wontDo = false;
  commit();
}
function wontDo(id){
  const t = findTask(id); if (!t) return;
  const prev = {done: t.done, doneAt: t.doneAt, wontDo: t.wontDo};
  t.done = true; t.wontDo = true; t.doneAt = todayStr();
  commit();
  toast(`Won't do: ${t.title}`, 'Undo', () => { Object.assign(t, prev); commit(); });
}
function toggleFocus(id){
  const t = findTask(id); if (!t || t.done) return;
  const on = t.focusOn === todayStr();
  t.focusOn = on ? null : todayStr();
  commit();
  if (!on && state.view !== 'today') toast('Added to Today');
}
function deleteTask(id){
  const i = state.tasks.findIndex(t => t.id === id); if (i < 0) return;
  const [t] = state.tasks.splice(i, 1);
  if (t.ado) state.ado.skip.push(t.ado.id);
  if (t.pr) state.ado.skipPr.push(t.pr.key);
  if (drawerId === id) closeDrawer(true);
  commit();
  toast(t.ado || t.pr ? 'Task deleted. It won\'t come back from ADO.' : 'Task deleted', 'Undo', () => {
    state.tasks.push(t); if (t.ado) state.ado.skip = state.ado.skip.filter(n => n !== t.ado.id);
    if (t.pr) state.ado.skipPr = state.ado.skipPr.filter(k => k !== t.pr.key); normalizeRanks(state); commit();
  });
}
// Reassign the existing rank slots of these tasks in the given order (hidden tasks keep their place).
function applyOrder(ids){
  const tasks = ids.map(findTask).filter(Boolean);
  const slots = tasks.map(t => t.rank).sort((a,b) => a - b);
  tasks.forEach((t,i) => t.rank = slots[i]);
  commit();
}
function moveTask(id, how){
  const t = findTask(id); if (!t || t.done) return false;
  const list = state.view === 'today' && isFocus(t) ? scopeOpen().filter(isFocus) : scopeOpen();
  const i = list.findIndex(x => x.id === id); if (i < 0) return false;
  const j = how === 'top' ? 0 : how === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= list.length || j === i) return false;
  const ids = list.map(x => x.id); ids.splice(i, 1); ids.splice(j, 0, id);
  applyOrder(ids);
  return true;
}
// Dragging into a quadrant changes only what's needed to land there (Build spec: Quadrant drops).
function applyDrop(t, zone, kind){
  const raise = () => { if (!t.value || t.value < 3) t.value = 3; };
  const lower = () => { if (!t.value || t.value > 2) t.value = 2; };
  const small = () => { if (!t.effort || POINTS[t.effort] > 2) t.effort = 'S'; };
  const large = () => { if (!t.effort || POINTS[t.effort] < 3) t.effort = 'M'; };
  switch (zone){
    case 'do':       raise(); t.urgentFlag = true;  break;
    case 'schedule': raise(); t.urgentFlag = false; break;
    case 'delegate': lower(); t.urgentFlag = true;  break;
    case 'drop':     lower(); t.urgentFlag = false; break;
    case 'quick': raise(); small(); break;
    case 'big':   raise(); large(); break;
    case 'fill':  lower(); small(); break;
    case 'pit':   lower(); large(); break;
    case 'none':  t.value = null; if (kind === 'eisen') t.urgentFlag = false; else t.effort = null; break;
  }
}
function dropIntoQuadrant(t, zone, kind){
  const before = {value: t.value, effort: t.effort, urgentFlag: t.urgentFlag};
  applyDrop(t, zone, kind);
  commit();
  const undo = ['Undo', () => { Object.assign(t, before); commit(); }];
  if ((zone === 'schedule' || zone === 'drop') && t.due && urgency(t) === 2){
    toast(`Due ${fmtDay(t.due)}, so it stays urgent`, [['Open', () => openDrawer(t.id)], undo]);
  } else {
    const Q = kind === 'eisen' ? EQ : VQ;
    toast(zone === 'none' ? 'Moved to Unsorted' : `Moved to ${Q[zone].title}`, [undo]);
  }
}
function downgradeUrgent(id){
  const t = findTask(id); if (!t) return;
  t.urgentFlag = false; commit();
  toast('No longer urgent', 'Undo', () => { t.urgentFlag = true; commit(); });
}

export { addTask, applyOrder, deleteTask, downgradeUrgent, dropIntoQuadrant, moveTask, toggleDone, toggleFocus, wontDo };
