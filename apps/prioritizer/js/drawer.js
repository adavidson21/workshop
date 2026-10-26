import { deleteTask, moveTask, toggleDone, toggleFocus, wontDo } from './actions.js';
import { ADO_GONE, PR_GONE, PR_TIER } from './ado.js';
import { EFFORTS, EQ, ICON, POINTS, VALUE, VQ } from './constants.js';
import { engDrawer, engOpen, engStart } from './eng.js';
import { ageDays, eKey, fmtScore, impliedDue, isStale, score, vKey } from './model.js';
import { app, drawer, main, render, sel, setSel } from './render.js';
import { canonPerson, commit, findTask, isWaiting, orderedLists, save, scopeOpen, state } from './state.js';
import { esc, fmtDay, fmtLong, isDate, todayStr } from './util.js';
import { dayLabel } from './views.js';
/* Prioritizer: Selection, keyboard navigation between rows, and the task details drawer. */
/* ---------- selection + keyboard navigation ---------- */
function visibleRows(){ return [...main.querySelectorAll('.row[data-id]')].filter(el => el.offsetParent !== null); }
function markSel(){
  main.querySelectorAll('.row.sel').forEach(el => el.classList.remove('sel'));
  if (!sel) return;
  const el = main.querySelector(`.row[data-id="${sel}"]`);
  if (el) el.classList.add('sel');
}
function focusSel(){
  const el = sel && main.querySelector(`.row[data-id="${sel}"]`);
  if (el){ el.focus({preventScroll: true}); el.scrollIntoView({block: 'nearest'}); }
}
function moveSel(d){
  const rows = visibleRows(); if (!rows.length) return;
  let i = rows.findIndex(el => el.dataset.id === sel);
  i = i < 0 ? (d > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, i + d));
  setSel(rows[i].dataset.id);
  markSel(); focusSel();
  if (drawerId) openDrawer(sel, false);
}

/* ---------- drawer (task details) ---------- */
let drawerId = null, drawerReturn = null, textTimer = null;
const drawerOverlay = () => drawerId && innerWidth < 1100;
function openDrawer(id, focusTitle = true){
  if (isWaiting() || !findTask(id)) return;
  if (!drawerId) drawerReturn = document.activeElement;
  drawerId = id; setSel(id);
  app.classList.add('drawer-open');
  renderDrawer();
  markSel();
  if (focusTitle){ const ti = drawer.querySelector('.d-title'); if (ti){ ti.focus(); ti.setSelectionRange(ti.value.length, ti.value.length); } }
}
function closeDrawer(silent){
  flushText();
  drawerId = null;
  app.classList.remove('drawer-open');
  drawer.innerHTML = '';
  if (!silent){
    const back = sel && main.querySelector(`.row[data-id="${sel}"]`);
    (back || (drawerReturn && drawerReturn.isConnected ? drawerReturn : null))?.focus?.({preventScroll: true});
  }
}
function syncDrawer(){
  if (!drawerId) return;
  if (!findTask(drawerId)) return closeDrawer(true);
  const a = document.activeElement;
  if (drawer.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return; // don't yank focus while typing
  renderDrawer();
}
function renderDrawer(){
  const t = findTask(drawerId); if (!t) return;
  const focusKey = drawer.contains(document.activeElement) ? document.activeElement.dataset.fk : null;
  const opts = orderedLists().map(l => `<option value="${l.id}"${l.id === t.listId ? ' selected' : ''}>${l.parentId ? '   ↳ ' : ''}${esc(l.name)}</option>`).join('');
  const open = scopeOpen(), idx = open.findIndex(x => x.id === t.id);
  const s = score(t), ek = eKey(t), vk = vKey(t), fon = t.focusOn === todayStr();
  const imp = impliedDue(t);
  drawer.innerHTML = `<div class="dhead"><span>${t.done ? (t.wontDo ? "Won't do" : `Done ${t.doneAt ? dayLabel(t.doneAt).toLowerCase() : ''}`) : idx >= 0 ? `Rank <span class="num">${idx + 1}</span> of <span class="num">${open.length}</span>` : ''}</span><span class="grow"></span>
      <button class="ibtn" data-d="close" data-fk="close" aria-label="Close details" data-tip="Close (Esc)">${ICON.x}</button></div>
    <div class="dbody">
      <textarea class="d-title" rows="1" data-f="title" data-fk="title" aria-label="Task">${esc(t.title)}</textarea>
      ${t.ado ? `<div class="dado"><a href="${esc(t.ado.url)}" target="_blank" rel="noopener" data-fk="adolink">Open ${esc(t.ado.type || 'item')} #${t.ado.id} in ADO</a><span>${esc(t.ado.state)}${t.ado.project ? ' · ' + esc(t.ado.project) : ''}</span>${t.ado.gone ? `<span class="chip">${ADO_GONE[t.ado.gone]}</span>` : ''}</div>` : ''}
      ${t.ado ? engDrawer(t) : ''}
      ${t.pr ? `<div class="dado"><a href="${esc(t.pr.url)}" target="_blank" rel="noopener" data-fk="prlink">Open PR ${t.pr.id} in ADO</a><span>${esc(t.pr.repo)}${t.pr.author ? ' · by ' + esc(t.pr.author) : ''}</span>${t.pr.gone ? `<span class="chip">${PR_GONE[t.pr.gone]}</span>` : `<span class="chip">${t.pr.waiting ? 'Waiting for author' : PR_TIER[t.pr.tier].label}</span>`}</div>` : ''}
      <textarea class="d-notes" rows="3" data-f="notes" data-fk="notes" placeholder="Notes" aria-label="Notes">${esc(t.notes)}</textarea>
      <div class="dfld"><span class="lbl">Value</span><div class="seg">${[1,2,3,4].map(v => `<button data-dv="${v}" data-fk="v${v}" aria-pressed="${t.value === v}"${t.value === v ? ' class="on"' : ''}>${VALUE[v]}</button>`).join('')}</div></div>
      <div class="dfld"><span class="lbl">Effort</span><div class="seg">${EFFORTS.map(e => `<button data-de="${e}" data-fk="e${e}" aria-pressed="${t.effort === e}"${t.effort === e ? ' class="on"' : ''}>${e}<span class="pts">${POINTS[e]}</span></button>`).join('')}</div></div>
      <div class="dfld"><label for="dDue">Due</label><div class="drow"><input type="date" id="dDue" data-f="due" data-fk="due" value="${t.due || ''}">${t.due ? `<button class="lnk" data-d="clear-due" data-fk="cdue">Clear</button>` : `<span class="hint">${imp ? `Implied ${fmtDay(imp)}` : 'Set a value to start aging'}</span>`}</div></div>
      <div class="dfld"><span class="lbl">Flags</span><div class="seg">
        <button data-d="urgent" data-fk="urg" aria-pressed="${t.urgentFlag}"${t.urgentFlag ? ' class="on"' : ''}>Urgent</button>
        <button data-d="today" data-fk="tday" aria-pressed="${fon}"${fon ? ' class="on"' : ''}${t.done ? ' disabled' : ''}>Today</button>
        <button data-d="waiting" data-fk="wait" aria-pressed="${t.waiting}"${t.waiting ? ' class="on"' : ''}>Waiting on someone</button></div></div>
      ${t.waiting ? `<div class="dfld"><label for="dNudge">Follow up on</label><div class="drow"><input type="date" id="dNudge" data-f="nudge" data-fk="nudge" value="${t.nudgeOn || ''}">${t.nudgeOn ? `<button class="lnk" data-d="clear-nudge" data-fk="cnudge">Clear</button>` : '<span class="hint">Shows a nudge on Today and their card</span>'}</div></div>` : ''}
      <div class="dfld"><label for="dPeople">People</label><input type="text" id="dPeople" list="dPeopleList" data-f="people" data-fk="people" value="${esc(t.people.join(', '))}" placeholder="Names, separated by commas" autocomplete="off">
        <datalist id="dPeopleList">${state.people.map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>
      <div class="dfld"><label for="dList">List</label><select id="dList" data-f="list" data-fk="list">${opts}</select></div>
      <div class="dinfo"><span>Added ${dayLabel(t.createdAt).toLowerCase() === 'today' ? 'today' : fmtLong(t.createdAt)}</span><span><span class="num">${ageDays(t)}</span> days on the clock</span>
        ${s != null ? `<span>Score <span class="num">${fmtScore(s)}</span></span>` : '<span>No score yet</span>'}
        ${ek ? `<span>${EQ[ek].title}</span>` : ''}${vk ? `<span>${VQ[vk].title}</span>` : ''}${isStale(t) ? '<span class="chip">Stale</span>' : ''}</div>
    </div>
    <div class="dfoot">
      ${!t.done && idx > 0 ? `<button class="btn ghost" data-d="top" data-fk="top" aria-label="Move to top" data-tip="Move to top">${ICON.top}<span class="hide-sm">Top</span></button><button class="btn ghost" data-d="up" data-fk="up" aria-label="Move up" data-tip="Move up (Alt+Up)">${ICON.up}<span class="hide-sm">Up</span></button>` : ''}
      <span class="grow"></span>
      ${t.done ? '' : `<button class="btn text-danger" data-d="wont" data-fk="wont">Won't do</button>`}
      <button class="btn text-danger" data-d="delete" data-fk="del">Delete</button>
      <button class="btn${t.done ? '' : ' primary'}" data-d="done" data-fk="done">${t.done ? 'Reopen' : 'Complete'}</button>
    </div>`;
  const ti = drawer.querySelector('.d-title');
  const fit = () => { ti.style.height = 'auto'; ti.style.height = ti.scrollHeight + 'px'; };
  fit();
  if (focusKey){ const f = drawer.querySelector(`[data-fk="${focusKey}"]`); if (f) f.focus({preventScroll: true}); }
}
function flushText(){
  if (!textTimer) return;
  clearTimeout(textTimer); textTimer = null;
  save(); renderMainOnly();
}
function renderMainOnly(){
  const d = drawerId; drawerId = null; // skip the drawer while someone is typing in it
  render(); drawerId = d;
}
drawer.addEventListener('input', e => {
  const t = findTask(drawerId); if (!t) return;
  const f = e.target.dataset.f;
  if (f === 'title'){
    e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px';
    const v = e.target.value.replace(/\s+/g, ' ').trim(); if (v) t.title = v;
  } else if (f === 'notes') t.notes = e.target.value.trim();
  else return;
  clearTimeout(textTimer);
  textTimer = setTimeout(() => { textTimer = null; save(); renderMainOnly(); }, 400);
});
drawer.addEventListener('keydown', e => {
  if (e.target.dataset.f === 'title' && e.key === 'Enter'){ e.preventDefault(); e.target.blur(); }
});
// flush typed text on blur; only re-render once focus has actually left the drawer, so a click on a drawer button isn't lost
drawer.addEventListener('focusout', e => {
  if (e.target.dataset.f !== 'title' && e.target.dataset.f !== 'notes') return;
  flushText();
  setTimeout(() => { if (!drawer.contains(document.activeElement)) syncDrawer(); }, 0);
});
drawer.addEventListener('change', e => {
  const t = findTask(drawerId); if (!t) return;
  const f = e.target.dataset.f, v = e.target.value;
  if (f === 'due') t.due = isDate(v) ? v : null;
  else if (f === 'nudge') t.nudgeOn = isDate(v) ? v : null;
  else if (f === 'people') t.people = [...new Set(v.split(',').map(canonPerson).filter(Boolean))];
  else if (f === 'list') t.listId = v;
  else return;
  commit();
});
drawer.addEventListener('click', e => {
  const t = findTask(drawerId); if (!t) return;
  const dv = e.target.closest('[data-dv]'); if (dv){ const v = +dv.dataset.dv; t.value = t.value === v ? null : v; return commit(); }
  const de = e.target.closest('[data-de]'); if (de){ t.effort = t.effort === de.dataset.de ? null : de.dataset.de; return commit(); }
  const b = e.target.closest('[data-d]'); if (!b) return;
  const a = b.dataset.d;
  if (a === 'close') return closeDrawer();
  if (a === 'clear-due'){ t.due = null; return commit(); }
  if (a === 'clear-nudge'){ t.nudgeOn = null; return commit(); }
  if (a === 'urgent'){ t.urgentFlag = !t.urgentFlag; return commit(); }
  if (a === 'today') return toggleFocus(t.id);
  if (a === 'waiting'){ t.waiting = !t.waiting; if (!t.waiting) t.nudgeOn = null; return commit(); }
  if (a === 'top' || a === 'up') return moveTask(t.id, a);
  if (a === 'wont') return wontDo(t.id);
  if (a === 'delete') return deleteTask(t.id);
  if (a === 'done') return toggleDone(t.id);
  if (a === 'eng-open') return engOpen(t.ado.id);
  if (a === 'eng-start') return engStart(t, b.dataset.lane, b);
});

export { closeDrawer, drawerId, drawerOverlay, flushText, focusSel, markSel, moveSel, openDrawer, renderMainOnly, syncDrawer };
