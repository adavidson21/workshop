/* Docket: the Day view. Time blocks for a sprint day: sections from a template, tasks slotted into them, and the
   tools for a chaotic day (lose a block, shift the rest, undo). The model is dayplan-model.js; saving and undo
   are dayplan.js. All user text is escaped with esc(). */
import { ICON, POINTS, TOUCH } from './constants.js';
import {
  COLORS, addDays, addSection, carryCandidates, carryOver, carryPending, cleanSprint, cleanTemplate, currentSection, dayView, dismissCarry,
  daysBetween, formatDays, isDate, sprintDayDate, isTime, loseSection, moveInSection, moveSection, nextWorkday, overCapacity, parseDays, placeSection, removeSection,
  resetDay, restFrom, restoreSection, sectionLoad, sectionOf, sectionTasks, shiftDay, slotOf, slotTask, sprintInfo, templateErrors,
  toMin, unslotTask, updateSection
} from './dayplan-model.js';
import { dp, dpChange, dpRedo, dpUndo, ensureYear, history, setRecurring, setSprint, setTemplates } from './dayplan.js';
import { cmdOpen } from './command-bar.js';
import { closeMenu, closeModal, confirmBox, menuEl, modal, popMenu, showModal, toast } from './overlays.js';
import { main, render, row, sel, setSel } from './render.js';
import { findTask, isWaiting, orderedLists, scopeName, scopeOpen, state } from './state.js';
import { EFFORTS, VALUE } from './constants.js';
import { $, esc, fmtLong, plural, todayStr } from './util.js';

let date = null, followToday = true, trayFilter = 'all', lastNow = null, secDrag = null;
const curDate = () => (followToday || !date) ? todayStr() : date;
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const tasksById = () => new Map(state.tasks.map(t => [t.id, t]));
const icon = d => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  undo: icon('<path d="M7.5 5L4 8.5 7.5 12"/><path d="M4.5 8.5h7a4.5 4.5 0 0 1 0 9H9"/>'),
  redo: icon('<path d="M12.5 5L16 8.5 12.5 12"/><path d="M15.5 8.5h-7a4.5 4.5 0 0 0 0 9H11"/>'),
  gear: icon('<circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6"/>'),
  plan: icon('<path d="M4 10h10M10.5 6l4 4-4 4"/>'),
  day: icon('<rect x="3" y="4.5" width="14" height="12" rx="2"/><path d="M3 8.5h14M7 2.8v3.2M13 2.8v3.2M6.5 11.5h4M6.5 14h7"/>')
};
function setDate(d){
  if (!isDate(d)) return;
  followToday = d === todayStr();
  date = d; setSel(null);
  ensureYear(d);
  render();
  main.scrollTop = 0;
}

/* ---------- header ---------- */
function dayHead(){
  const d = curDate(), info = sprintInfo(dp.sprint, d);
  const where = info ? (info.off ? `Sprint ${info.id} · ${info.holiday ? 'Holiday' : 'Day off'}` : `Sprint ${info.id}, day ${info.day} of ${info.total}`) : 'No sprint set';
  const sub = `${esc(where)} · ${esc(fmtLong(d))} · ${esc(scopeName())}`;
  $('#phead').innerHTML = `<button class="ibtn menu-btn" id="menuBtn" aria-label="Open menu">${ICON.menu}</button>
    <div class="ptitle"><h1>Day</h1><button class="scopebtn" data-scopemenu aria-label="Change scope">${sub}${ICON.chevD}</button></div>
    <div class="htools">
      <div class="dnav"><button class="ibtn" data-dp="prev" aria-label="Previous working day" data-tip="Previous working day ([)">${ICON.chevL}</button>
        <input type="date" id="dpDate" value="${d}" aria-label="Day to plan">
        <button class="ibtn" data-dp="next" aria-label="Next working day" data-tip="Next working day (])">${ICON.chevR}</button>
        ${d !== todayStr() ? `<button class="btn" data-dp="today">Today</button>` : ''}</div>
      <button class="ibtn" data-dp="undo" aria-label="Undo" data-tip="Undo (Ctrl+Z)"${history.canUndo ? '' : ' disabled'}>${I.undo}</button>
      <button class="ibtn" data-dp="redo" aria-label="Redo" data-tip="Redo (Ctrl+Shift+Z)"${history.canRedo ? '' : ' disabled'}>${I.redo}</button>
      <button class="btn" data-dp="daymenu" aria-haspopup="menu">This day ${ICON.chevD}</button>
      <button class="ibtn" data-dp="settings" aria-label="Day plan settings" data-tip="Sprint and templates">${I.gear}</button>
    </div>`;
}

/* ---------- main ---------- */
function renderDay(){
  if (!dp.sprint.anchor) return renderSetup();
  const d = curDate(), byId = tasksById();
  const {rec, info, template, conflict, saved} = dayView(dp, d);
  const isToday = d === todayStr();
  const now = isToday ? currentSection(rec, nowMin()) : {current: null, next: null};
  lastNow = now.current ? now.current.id : null;
  let banners = '';
  if (info.off) banners += `<div class="banner"><span>${info.holiday ? 'A holiday' : 'A day off'}. It doesn't count as a sprint day.</span>${rec.sections.length ? '' : `<button class="btn" data-dp="addsec">Plan it anyway</button>`}</div>`;
  if (conflict.length) banners += `<div class="banner warn"><span>${conflict.map(t => `"${esc(t.name)}"`).join(' and ')} both match this day, so the first one is used. Fix it in templates.</span><button class="btn" data-dp="settings">Templates</button></div>`;
  if (!info.off && carryPending(dp, d, byId)){
    const c = carryCandidates(dp, d, byId);
    banners += `<div class="banner"><span>${plural(c.items.length, 'unfinished task')} from ${esc(fmtLong(c.prev))}.</span>
      <button class="btn ghost" data-dp="carry-skip">Dismiss</button><button class="btn" data-dp="carry-tray">Put in the tray</button><button class="btn primary" data-dp="carry-sections">Same blocks today</button></div>`;
  }
  const secs = rec.sections.map(s => section(rec, s, byId, now)).join('');
  const empty = !rec.sections.length && !info.off ? `<div class="focus-empty"><b>No blocks yet.</b>${template ? 'This day\'s template has no blocks.' : dp.templates.length ? `No template covers day ${info.day}.` : 'Make a template once, and every sprint day starts from it.'}
      <div class="acts"><button class="btn" data-dp="addsec">Add a block</button><button class="btn primary" data-dp="settings">${dp.templates.length ? 'Edit templates' : 'Set up templates'}</button></div></div>` : '';
  main.innerHTML = `${banners}<div class="focus dayplan">
    <div class="fmain"><div class="dsecs">${secs}</div>${empty}
      <p class="soft">${saved ? `Edited for this day. <button class="lnk" data-dp="reset">Reset to template</button>` : template ? `From the "${esc(template.name)}" template. Changes here are for this day only.` : ''}</p></div>
    <aside>${tray(rec, byId, d)}</aside></div>`;
}

function section(rec, s, byId, now){
  const items = sectionTasks(rec, s.id, byId);
  const load = sectionLoad(rec, s.id, byId, POINTS), over = overCapacity(s, load);
  const isNow = now.current && now.current.id === s.id, isNext = !now.current && now.next && now.next.id === s.id;
  const end = s.around && s.minutes ? ` to ${minToStr(toMin(s.around) + s.minutes)}` : '';
  const time = s.around ? `<span class="dtime">${esc(s.around)}${esc(end)}</span>` : s.minutes ? `<span class="dtime">${s.minutes} min</span>` : '';
  const rows = items.map(({task}) => withBtn(row(task, {compact: true, showList: true, noToday: true}),
    `<button class="ibtn dpbtn" data-dp="rowmenu" aria-label="Options for ${esc(task.title)}" data-tip="Move or unplan (P)">${ICON.dots}</button>`)).join('');
  return `<section class="dsec${s.lost ? ' lost' : ''}${isNow ? ' now' : ''}" data-color="${esc(s.color)}" data-sec="${esc(s.id)}">
    <header class="dsec-h" data-sechead="${esc(s.id)}" tabindex="0"${TOUCH ? '' : ' draggable="true"'} aria-label="Block ${esc(s.name)}">
      ${time}<h3>${esc(s.name)}</h3>${s.kind ? `<span class="chip">${esc(s.kind)}</span>` : ''}
      ${isNow ? '<span class="chip acc">Now</span>' : isNext ? '<span class="chip">Next</span>' : ''}${s.lost ? '<span class="chip warn">Lost</span>' : ''}
      <span class="grow"></span>
      ${s.capacity != null || load ? `<span class="dcap${over ? ' over' : ''}" data-tip="${over ? 'Over capacity' : 'Planned effort points'}">${load}${s.capacity != null ? ` / ${s.capacity}` : ''} pts</span>` : ''}
      ${s.lost ? `<button class="btn ghost" data-dp="restore">Restore</button>` : ''}
      <button class="ibtn" data-dp="secmenu" aria-label="Options for block ${esc(s.name)}" data-tip="Block options">${ICON.dots}</button>
    </header>
    ${over ? `<div class="dwarn" role="note">Over capacity: ${load} of ${s.capacity} pts planned.</div>` : ''}
    <div class="rows dropzone" data-zone="dsec" data-sec="${esc(s.id)}">${rows || `<div class="qhint">${s.lost ? 'Gone for today' : TOUCH ? 'Use the arrow on a task to plan it here' : 'Drop tasks here, or press P on a task'}</div>`}</div>
  </section>`;
}
const minToStr = m => { m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const withBtn = (html, btn) => html.replace(/<\/article>$/, btn + '</article>');

function tray(rec, byId, d){
  const planned = new Set(rec.slots.map(s => s.taskId));
  let open = scopeOpen().filter(t => !planned.has(t.id));
  if (trayFilter === 'today') open = open.filter(t => t.focusOn === todayStr());
  const carried = (rec.carry && rec.carry.tray || []).filter(id => open.some(t => t.id === id));
  const first = carried.map(id => byId.get(id)), rest = open.filter(t => !carried.includes(t.id));
  const btn = t => `<button class="ibtn dpbtn" data-dp="pick" aria-label="Plan ${esc(t.title)}" data-tip="Plan into a block (P)">${I.plan}</button>`;
  const r = t => withBtn(row(t, {compact: true, showList: true, noToday: true}), btn(t));
  return `<section class="panel dtray dropzone" data-zone="dtray">
    <header><h3>Not planned</h3><span class="n">${open.length}</span>
      <div class="lens small" role="tablist" aria-label="Show"><button data-dp="tray-all" role="tab" aria-selected="${trayFilter === 'all'}"${trayFilter === 'all' ? ' class="on"' : ''}>All</button><button data-dp="tray-today" role="tab" aria-selected="${trayFilter === 'today'}"${trayFilter === 'today' ? ' class="on"' : ''}>Today list</button></div></header>
    ${first.length ? `<div class="dsub">Carried over</div><div class="rows">${first.map(r).join('')}</div><div class="dsub">By rank</div>` : ''}
    <div class="rows">${rest.map(r).join('') || `<div class="pempty">${open.length ? '' : trayFilter === 'today' ? 'Nothing on your Today list is left to plan.' : 'Everything open is planned.'}</div>`}</div>
    <p class="soft">${TOUCH ? 'Tap the arrow on a task to put it in a block.' : 'Drag a task into a block, or select it and press P.'}</p>
  </section>`;
}

function renderSetup(){
  const t = todayStr();
  main.innerHTML = `<div class="focus-empty dsetup"><b>When does a sprint start?</b>Pick the first day of any sprint, past or future. Sprint days are counted from it.
    <form class="dsetup-f" id="dpSetup">
      <label>A sprint starts on <input type="date" name="anchor" value="${t}" required></label>
      <label>Length <select name="len">${[1, 2, 3, 4].map(n => `<option value="${n}"${n === 2 ? ' selected' : ''}>${plural(n, 'week')}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" name="example" checked> Start with example templates</label>
      <button class="btn primary">Start planning</button>
    </form><p class="dhelp">Workdays, holidays and templates are in settings (the gear) any time.</p></div>`;
}

/* Example templates so the first day is usable at once. Edit or delete them in settings. */
function exampleTemplates(sp){
  const len = sp.lengthWeeks * 5, s = (name, kind, color, around, minutes, capacity = null) => ({name, kind, color, around, minutes, capacity});
  return [
    {name: 'Planning day', days: [1], last: false, sections: [s('Plan the sprint', 'meetings', 'sky', '09:30', 120), s('Focus', 'focus', 'sage', '12:30', 120, 5), s('Admin and inbox', 'admin', 'butter', '15:00', 60, 3)]},
    {name: 'Sprint day', days: Array.from({length: Math.max(0, len - 1)}, (_, i) => i + 2), last: false, sections: [s('Warm up: inbox and plan', 'admin', 'butter', '09:00', 30, 2), s('Deep focus', 'focus', 'sage', '09:30', 150, 5), s('Meetings', 'meetings', 'sky', '13:00', 120), s('Shallow work', 'admin', 'peach', '15:00', 90, 3), s('Wrap up', 'review', 'lavender', '16:30', 30, 1)]},
    {name: 'Last day', days: [], last: true, sections: [s('Finish and review', 'review', 'lavender', '09:00', 150, 5), s('Demo and retro', 'meetings', 'sky', '13:00', 120), s('Clean up for next sprint', 'admin', 'butter', '15:30', 60, 3)]}
  ].map(t => cleanTemplate(Object.assign(t, {sections: t.sections.map(x => Object.assign(x, {id: Math.random().toString(36).slice(2, 9)}))})));
}

/* ---------- actions ---------- */
function plan(taskId, sectionId, d = curDate(), index = null){
  const t = findTask(taskId), byId = tasksById();
  const rec = dayView(dp, d).rec, s = sectionOf(rec, sectionId);
  if (!t || !s) return;
  dpChange([d], () => slotTask(dp, d, taskId, sectionId, index, byId));
  if (s.lost) toast(`"${s.name}" is marked lost for today`);
}
function unplan(taskId, d = curDate()){ dpChange([d], () => unslotTask(dp, d, taskId)); }

/* Pick a block for a task (keyboard, touch, or a row's button). */
function pickSection(taskId, anchor){
  const d = curDate(), rec = dayView(dp, d).rec, slot = slotOf(rec, taskId), t = findTask(taskId);
  if (!t) return;
  const open = rec.sections.filter(s => !s.lost);
  const html = (open.length ? `<div class="mnote">${slot ? 'Move to' : 'Plan into'}</div>` + open.map((s, i) => `<button data-to="${esc(s.id)}"${slot && slot.sectionId === s.id ? ' class="on"' : ''}><span class="dsw" data-color="${esc(s.color)}"></span>${i < 9 ? `<kbd>${i + 1}</kbd>` : ''}${esc(s.name)}${s.around ? ` <span class="mut">${esc(s.around)}</span>` : ''}</button>`).join('')
    : `<div class="mnote">This day has no open blocks.</div><button data-dpm="addsec">Add a block</button>`)
    + (slot ? `<div class="sep"></div><button data-dpm="up">Move up</button><button data-dpm="down">Move down</button><button data-dpm="unplan">Back to the tray</button>` : '');
  const m = popMenu(html, anchor || main.querySelector(`.row[data-id="${CSS.escape(taskId)}"]`) || main, 'right');
  m.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    closeMenu(true);
    if (b.dataset.to) return plan(taskId, b.dataset.to);
    const a = b.dataset.dpm;
    if (a === 'addsec') return editSection(null);
    if (a === 'unplan') return unplan(taskId);
    if (a === 'up' || a === 'down') dpChange([d], () => moveInSection(dp, d, taskId, a === 'up' ? -1 : 1, tasksById()));
  });
  m.addEventListener('keydown', e => {
    if (/^[1-9]$/.test(e.key) && open[+e.key - 1]){ e.preventDefault(); e.stopPropagation(); closeMenu(true); plan(taskId, open[+e.key - 1].id); }
  });
}

function sectionMenu(secId, anchor){
  const d = curDate(), rec = dayView(dp, d).rec, s = sectionOf(rec, secId); if (!s) return;
  popMenu(`<button data-sm="edit">Edit block</button><button data-sm="up">Move up</button><button data-sm="down">Move down</button><div class="sep"></div>
    ${s.lost ? '<button data-sm="restore">Restore block</button>' : '<button data-sm="lose">Lost this block</button>'}
    <button data-sm="shift">Shift the rest of the day from here</button><div class="sep"></div><button data-sm="remove" class="danger">Remove for this day</button>`, anchor, 'right')
    .addEventListener('click', e => {
      const b = e.target.closest('[data-sm]'); if (!b) return;
      closeMenu(true);
      const a = b.dataset.sm;
      if (a === 'edit') editSection(secId);
      if (a === 'up' || a === 'down') dpChange([d], () => moveSection(dp, d, secId, a === 'up' ? -1 : 1));
      if (a === 'lose') loseDialog(secId);
      if (a === 'restore') dpChange([d], () => restoreSection(dp, d, secId));
      if (a === 'shift') shiftDialog(secId);
      if (a === 'remove'){
        const n = sectionTasks(rec, secId, tasksById()).length;
        dpChange([d], () => removeSection(dp, d, secId));
        toast(`Removed "${s.name}" for this day${n ? `. ${plural(n, 'task')} back in the tray` : ''}`, 'Undo', undo);
      }
    });
}

function dayMenu(anchor){
  const d = curDate(), v = dayView(dp, d);
  popMenu(`<button data-dm="addsec">Add a block</button><button data-dm="shift">Shift the rest of the day</button><div class="sep"></div>
    ${v.saved ? '<button data-dm="reset" class="danger">Reset to template</button>' : ''}<button data-dm="settings">Sprint and templates</button>`, anchor, 'right')
    .addEventListener('click', e => {
      const b = e.target.closest('[data-dm]'); if (!b) return;
      closeMenu(true);
      ({addsec: () => editSection(null), shift: () => shiftDialog(null), reset: resetDialog, settings: openSettings})[b.dataset.dm]();
    });
}

function editSection(secId){
  const d = curDate(), s = secId ? sectionOf(dayView(dp, d).rec, secId) : {name: '', kind: '', color: 'slate', around: null, minutes: null, capacity: null};
  if (!s) return;
  showModal(`<form class="sheet small dform" role="dialog" aria-modal="true" aria-label="${secId ? 'Edit block' : 'Add a block'}"><h3>${secId ? 'Edit block' : 'Add a block'}</h3>
    <p class="dhelp">For ${esc(fmtLong(d))} only. Templates are in settings.</p>
    ${sectionFields(s)}
    <footer><span class="grow"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${secId ? 'Save' : 'Add'}</button></footer></form>`,
    f => {
      f.querySelector('[name=name]').focus();
      f.addEventListener('submit', e => {
        e.preventDefault();
        const v = readSection(f);
        if (!v.name){ f.querySelector('[name=name]').focus(); return; }
        closeModal();
        if (secId) dpChange([d], () => updateSection(dp, d, secId, v));
        else dpChange([d], () => addSection(dp, d, v));
      });
    });
}
function sectionFields(s){
  return `<div class="dgrid">
    <label class="wide">Name <input name="name" maxlength="80" value="${esc(s.name)}" required autocomplete="off"></label>
    <label>Kind <input name="kind" maxlength="40" value="${esc(s.kind)}" placeholder="focus, meetings, admin" list="dpKinds" autocomplete="off"></label>
    <label>Color <select name="color">${COLORS.map(c => `<option value="${c}"${s.color === c ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
    <label>Around <input type="time" name="around" value="${esc(s.around || '')}"></label>
    <label>Minutes <input type="number" name="minutes" min="0" max="1440" step="5" value="${s.minutes ?? ''}"></label>
    <label>Capacity (pts) <input type="number" name="capacity" min="0" max="99" step="1" value="${s.capacity ?? ''}"></label>
  </div><datalist id="dpKinds">${kinds().map(k => `<option value="${esc(k)}">`).join('')}</datalist>`;
}
const kinds = (ts = dp.templates) => [...new Set(['focus', 'meetings', 'admin', 'review', ...ts.flatMap(t => t.sections.map(s => s.kind)).filter(Boolean)])];
function readSection(root){
  const g = n => root.querySelector(`[name=${n}]`).value.trim();
  return {name: g('name'), kind: g('kind'), color: g('color'), around: isTime(g('around')) ? g('around') : null,
    minutes: g('minutes') === '' ? null : +g('minutes'), capacity: g('capacity') === '' ? null : +g('capacity')};
}

function loseDialog(secId){
  const d = curDate(), byId = tasksById(), rec = dayView(dp, d).rec, s = sectionOf(rec, secId); if (!s) return;
  const n = sectionTasks(rec, secId, byId).filter(x => !x.task.done).length;
  const i = rec.sections.indexOf(s), nextOpen = rec.sections.slice(i + 1).find(x => !x.lost);
  const tmr = nextWorkday(dp.sprint, d) || addDays(d, 1);
  const tsecs = dayView(dp, tmr).rec.sections.filter(x => !x.lost), tTo = tsecs.find(x => x.kind && x.kind === s.kind) || tsecs[0];
  const go = dest => {
    const r = dpChange(dest === 'tomorrow' ? [d, tmr] : [d], () => loseSection(dp, d, secId, dest, byId));
    const where = !r || !r.count ? '' : r.section ? ` ${plural(r.count, 'task')} moved to ${r.section.name}${dest === 'tomorrow' ? ` on ${fmtLong(r.date)}` : ''}.` : dest === 'tomorrow' ? ` ${plural(r.count, 'task')} will wait in the tray on ${fmtLong(r.date)}.` : ` ${plural(r.count, 'task')} went back to the tray.`;
    toast(`Lost "${s.name}".${where}`, 'Undo', undo, 8000);
  };
  if (!n) return go('next');
  showModal(`<div class="sheet small" role="dialog" aria-modal="true" aria-label="Lost this block"><h3>Lost "${esc(s.name)}"</h3>
    <p>Where should its ${plural(n, 'unfinished task')} go?</p>
    <div class="dchoice">
      <label><input type="radio" name="dest" value="next" checked> ${nextOpen ? `The next open block today: <b>${esc(nextOpen.name)}</b>` : 'Back to the tray (no open block is left today)'}</label>
      <label><input type="radio" name="dest" value="tomorrow"> ${tTo ? `<b>${esc(tTo.name)}</b> on ${esc(fmtLong(tmr))}` : `The tray on ${esc(fmtLong(tmr))}`}</label>
    </div>
    <footer><span class="grow"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>Lose block</button></footer></div>`,
    sh => { const ok = sh.querySelector('[data-ok]'); ok.focus(); ok.onclick = () => { const v = sh.querySelector('[name=dest]:checked').value; closeModal(); go(v); }; });
}

function shiftDialog(fromId){
  const d = curDate(), rec = dayView(dp, d).rec;
  const from = fromId || (d === todayStr() ? restFrom(rec, nowMin()) : null);
  const fromSec = from && sectionOf(rec, from);
  if (d === todayStr() && !from){ toast('No timed blocks are left today to shift.'); return; }
  showModal(`<div class="sheet small" role="dialog" aria-modal="true" aria-label="Shift the rest of the day"><h3>Shift the rest of the day</h3>
    <p>${fromSec ? `Moves "${esc(fromSec.name)}" and every open block after it.` : 'Moves every open block on this day.'}</p>
    <div class="seg dshift">${[15, 30, 60].map(m => `<button data-m="${m}">+${m} min</button>`).join('')}<button data-m="-15">-15 min</button></div>
    <label class="dcustom">Or minutes <input type="number" step="5" min="-600" max="600" placeholder="45" id="dpShiftN"><button class="btn" data-m="custom">Shift</button></label>
    <footer><span class="grow"></span><button class="btn" data-close>Cancel</button></footer></div>`,
    sh => {
      sh.querySelector('[data-m]').focus();
      sh.addEventListener('click', e => {
        const b = e.target.closest('[data-m]'); if (!b) return;
        const m = b.dataset.m === 'custom' ? Math.round(+sh.querySelector('#dpShiftN').value) : +b.dataset.m;
        if (!m) return sh.querySelector('#dpShiftN').focus();
        closeModal();
        const n = dpChange([d], () => shiftDay(dp, d, m, from));
        toast(`Shifted ${plural(n, 'block')} by ${m > 0 ? '+' : ''}${m} min`, 'Undo', undo);
      });
    });
}

function resetDialog(){
  const d = curDate();
  confirmBox('Reset to template?', `This drops every change made on ${fmtLong(d)}: blocks, lost blocks, shifts and planned tasks. You can undo it.`, 'Reset',
    () => { dpChange([d], () => resetDay(dp, d)); toast('Reset to template', 'Undo', undo); });
}

function undo(){ if (dpUndo()) toast('Undone', 'Redo', redo); else toast('Nothing to undo'); }
function redo(){ if (!dpRedo()) toast('Nothing to redo'); }

/* ---------- settings: sprint and templates ---------- */
const WD = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
let draft = null;
function openSettings(focus){
  draft = {sprint: JSON.parse(JSON.stringify(dp.sprint)), templates: JSON.parse(JSON.stringify(dp.templates)), recurring: JSON.parse(JSON.stringify(dp.recurring))};
  showModal(`<div class="sheet wide dsettings" role="dialog" aria-modal="true" aria-label="Sprint and templates"></div>`, sh => {
    drawSettings(sh);
    if (focus === 'recurring'){ const r = sh.querySelector('.drec'); if (r) r.scrollIntoView({block: 'start'}); }
    sh.addEventListener('input', e => readSettingsField(e.target));
    sh.addEventListener('change', e => { readSettingsField(e.target); if (e.target.dataset.redraw != null) drawSettings(sh); else showErrors(sh); });
    sh.addEventListener('click', e => settingsClick(e, sh));
  });
}
function drawSettings(sh){
  const sp = draft.sprint;
  sh.innerHTML = `<h3>Sprint and templates</h3>
    <section class="dset"><h4>Sprint</h4><div class="dgrid">
      <label>A sprint starts on <input type="date" data-s="anchor" value="${esc(sp.anchor || '')}"></label>
      <label>Length (weeks) <input type="number" min="1" max="8" data-s="lengthWeeks" value="${sp.lengthWeeks}" data-redraw></label>
      <label>Day starts <input type="time" data-s="dayStart" value="${esc(sp.dayStart)}"></label>
      <label>Day ends <input type="time" data-s="dayEnd" value="${esc(sp.dayEnd)}"></label>
      <fieldset class="wide"><legend>Workdays</legend>${WD.map(([n, l]) => `<label class="chk"><input type="checkbox" data-wd="${n}"${sp.workdays.includes(n) ? ' checked' : ''}> ${l}</label>`).join('')}</fieldset>
      <div class="wide"><span class="lbl">Holidays</span><div class="dhol">${sp.holidays.map(h => `<span class="chip">${esc(fmtLong(h))} <button class="lnk" data-delhol="${esc(h)}" aria-label="Remove ${esc(h)}">${ICON.x}</button></span>`).join('') || '<span class="mut">None</span>'}
        <input type="date" id="dpHol" aria-label="Holiday to add"><button class="btn" data-addhol>Add</button></div></div>
    </div></section>
    <section class="dset"><h4>Templates</h4><p class="dhelp">Each template is a list of blocks for some sprint days, like <code>2-8</code>. <b>Last day</b> always matches the final working day, even when a holiday shortens the sprint.</p>
      <div class="derr" role="alert"></div>
      ${draft.templates.map((t, ti) => templateCard(t, ti)).join('')}
      <div class="acts"><button class="btn" data-addtpl>${ICON.plus} Template</button>${draft.templates.length ? '' : '<button class="btn" data-example>Add example templates</button>'}</div>
    </section>
    <section class="dset drec"><h4>Every sprint</h4><p class="dhelp">Tasks you do once a sprint, like refinement or a release. Each sprint, a new one is added on day 1 at the value you pick, due on its sprint day, so it's visible early and rises as the day gets close. With <b>Plan into</b>, it's also put in that kind of block on its due day.</p>
      ${draft.recurring.length ? `<div class="dtable"><table><thead><tr><th>Task</th><th>Due on</th><th>Plan into</th><th>Value</th><th>Effort</th><th>List</th><th></th></tr></thead><tbody>${draft.recurring.map(recurRow).join('')}</tbody></table></div>` : ''}
      <div class="acts"><button class="btn" data-addrec>${ICON.plus} Every-sprint task</button></div>
    </section>
    <footer><span class="grow"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-savesettings>Save</button></footer>`;
  showErrors(sh);
}
function templateCard(t, ti){
  const row = (s, si) => `<tr data-si="${si}">
    <td><input data-sf="name" value="${esc(s.name)}" maxlength="80" aria-label="Block name"></td>
    <td><input data-sf="kind" value="${esc(s.kind)}" maxlength="40" list="dpKinds" aria-label="Kind"></td>
    <td><select data-sf="color" aria-label="Color">${COLORS.map(c => `<option${s.color === c ? ' selected' : ''}>${c}</option>`).join('')}</select></td>
    <td><input type="time" data-sf="around" value="${esc(s.around || '')}" aria-label="Around"></td>
    <td><input type="number" data-sf="minutes" min="0" max="1440" step="5" value="${s.minutes ?? ''}" aria-label="Minutes"></td>
    <td><input type="number" data-sf="capacity" min="0" max="99" value="${s.capacity ?? ''}" aria-label="Capacity in points"></td>
    <td class="dact"><button class="ibtn" data-secup aria-label="Move up">${ICON.up}</button><button class="ibtn" data-secdel aria-label="Remove block">${ICON.x}</button></td></tr>`;
  return `<div class="dtpl" data-ti="${ti}"><div class="dtpl-h">
      <input data-tf="name" value="${esc(t.name)}" maxlength="80" aria-label="Template name" class="dtname">
      <label>Sprint days <input data-tf="days" value="${esc(formatDays(t.days))}" placeholder="2-8" aria-label="Sprint days"></label>
      <label class="chk"><input type="checkbox" data-tf="last"${t.last ? ' checked' : ''}> Last day</label>
      <button class="btn text-danger" data-deltpl>Delete</button></div>
    <div class="dtable"><table><thead><tr><th>Block</th><th>Kind</th><th>Color</th><th>Around</th><th>Min</th><th>Pts</th><th></th></tr></thead>
      <tbody>${t.sections.map(row).join('')}</tbody></table></div>
    <button class="btn ghost" data-addsec>${ICON.plus} Block</button></div>
    <datalist id="dpKinds">${kinds().map(k => `<option value="${esc(k)}">`).join('')}</datalist>`;
}
function recurRow(r, ri){
  const sp = cleanSprint(draft.sprint), max = sp.lengthWeeks * 7;
  const when = info => info ? ` (${info})` : '';
  const dayName = n => { if (!sp.anchor) return ''; const d = sprintDayDate(sp, sprintInfo(sp, todayStr()).start, n); return d ? new Date(d + 'T12:00').toLocaleDateString(undefined, {weekday: 'short'}) + ' wk ' + (Math.floor(daysBetween(sprintInfo(sp, todayStr()).start, d) / 7) + 1) : ''; };
  const opts = [`<option value="last"${r.last ? ' selected' : ''}>Last day</option>`].concat(Array.from({length: max}, (_, i) => i + 1)
    .filter(n => n <= sp.workdays.length * sp.lengthWeeks).map(n => `<option value="${n}"${!r.last && r.dueDay === n ? ' selected' : ''}>Day ${n}${when(dayName(n))}</option>`));
  return `<tr data-ri="${ri}">
    <td><input data-rf="title" value="${esc(r.title)}" maxlength="300" placeholder="Backlog refinement" aria-label="Task"></td>
    <td><select data-rf="due" aria-label="Due on">${opts.join('')}</select></td>
    <td><select data-rf="planKind" aria-label="Plan into a block on its due day"><option value="">Don't plan</option>${[...new Set([...kinds(draft.templates), r.planKind].filter(Boolean))].map(k => `<option value="${esc(k)}"${r.planKind === k ? ' selected' : ''}>${esc(k)} block</option>`).join('')}</select></td>
    <td><select data-rf="value" aria-label="Value">${[1, 2, 3, 4].map(v => `<option value="${v}"${r.value === v ? ' selected' : ''}>${VALUE[v]}</option>`).join('')}</select></td>
    <td><select data-rf="effort" aria-label="Effort">${EFFORTS.map(e => `<option${r.effort === e ? ' selected' : ''}>${e}</option>`).join('')}</select></td>
    <td><select data-rf="listId" aria-label="List">${orderedLists().map(l => `<option value="${esc(l.id)}"${r.listId === l.id ? ' selected' : ''}>${l.parentId ? '   ' : ''}${esc(l.name)}</option>`).join('')}</select></td>
    <td class="dact"><label class="chk" data-tip="Paused items don't make new tasks"><input type="checkbox" data-rf="paused"${r.paused ? ' checked' : ''}> Pause</label><button class="ibtn" data-recdel aria-label="Remove">${ICON.x}</button></td></tr>`;
}
function readSettingsField(el){
  const sp = draft.sprint;
  const reEl = el.closest && el.closest('[data-ri]');
  if (reEl && el.dataset.rf){
    const r = draft.recurring[+reEl.dataset.ri], f = el.dataset.rf;
    if (f === 'title') r.title = el.value;
    if (f === 'due'){ r.last = el.value === 'last'; if (!r.last) r.dueDay = +el.value; }
    if (f === 'value') r.value = +el.value;
    if (f === 'effort') r.effort = el.value;
    if (f === 'listId') r.listId = el.value;
    if (f === 'paused') r.paused = el.checked;
    if (f === 'planKind') r.planKind = el.value;
    return;
  }
  if (el.dataset.s){ const v = el.value; sp[el.dataset.s] = el.dataset.s === 'lengthWeeks' ? Math.max(1, Math.min(8, Math.round(+v) || 2)) : v || null; return; }
  if (el.dataset.wd != null){ const n = +el.dataset.wd; sp.workdays = el.checked ? [...new Set([...sp.workdays, n])] : sp.workdays.filter(x => x !== n); return; }
  const tEl = el.closest('[data-ti]'); if (!tEl) return;
  const t = draft.templates[+tEl.dataset.ti];
  if (el.dataset.tf === 'name') t.name = el.value;
  if (el.dataset.tf === 'days'){ const p = parseDays(el.value); t.days = p || t.days; el.classList.toggle('bad', !p); }
  if (el.dataset.tf === 'last') t.last = el.checked;
  const rEl = el.closest('[data-si]');
  if (rEl && el.dataset.sf){
    const s = t.sections[+rEl.dataset.si], f = el.dataset.sf, v = el.value;
    s[f] = f === 'minutes' || f === 'capacity' ? (v === '' ? null : +v) : f === 'around' ? (isTime(v) ? v : null) : v;
  }
}
function showErrors(sh){
  const errs = templateErrors(draft.templates.map(cleanTemplate), draft.sprint);
  const bad = [...sh.querySelectorAll('[data-tf=days].bad')].length ? ['Sprint days look like "2-8" or "1, 3, 5".'] : [];
  if (!draft.sprint.workdays.length) bad.push('Pick at least one workday.');
  const all = [...errs, ...bad];
  sh.querySelector('.derr').innerHTML = all.map(e => `<div>${esc(e)}</div>`).join('');
  return all;
}
function settingsClick(e, sh){
  const b = e.target.closest('button'); if (!b) return;
  const tEl = b.closest('[data-ti]'), t = tEl && draft.templates[+tEl.dataset.ti];
  const rEl = b.closest('[data-si]');
  const blank = () => ({id: Math.random().toString(36).slice(2, 9), name: 'New block', kind: '', color: 'slate', around: null, minutes: null, capacity: null});
  if (b.hasAttribute('data-addhol')){ const v = sh.querySelector('#dpHol').value; if (isDate(v) && !draft.sprint.holidays.includes(v)){ draft.sprint.holidays.push(v); draft.sprint.holidays.sort(); } drawSettings(sh); return; }
  if (b.dataset.delhol){ draft.sprint.holidays = draft.sprint.holidays.filter(h => h !== b.dataset.delhol); drawSettings(sh); return; }
  if (b.hasAttribute('data-addrec')){ draft.recurring.push({id: Math.random().toString(36).slice(2, 9), title: '', dueDay: 1, last: false, planKind: '', value: 2, effort: 'S', listId: (orderedLists()[0] || {}).id || null, paused: false, made: []}); drawSettings(sh); const t = sh.querySelectorAll('[data-rf=title]'); if (t.length) t[t.length - 1].focus(); return; }
  const reEl = b.closest('[data-ri]');
  if (b.hasAttribute('data-recdel') && reEl){ draft.recurring.splice(+reEl.dataset.ri, 1); drawSettings(sh); return; }
  if (b.hasAttribute('data-addtpl')){ draft.templates.push({id: Math.random().toString(36).slice(2, 9), name: 'New template', days: [], last: false, sections: [blank()]}); drawSettings(sh); return; }
  if (b.hasAttribute('data-example')){ draft.templates = exampleTemplates(cleanSprint(draft.sprint)); drawSettings(sh); return; }
  if (b.hasAttribute('data-deltpl') && t){ draft.templates.splice(+tEl.dataset.ti, 1); drawSettings(sh); return; }
  if (b.hasAttribute('data-addsec') && t){ t.sections.push(blank()); drawSettings(sh); const r = sh.querySelectorAll(`[data-ti="${tEl.dataset.ti}"] [data-sf=name]`); if (r.length) r[r.length - 1].select(); return; }
  if (b.hasAttribute('data-secdel') && t && rEl){ t.sections.splice(+rEl.dataset.si, 1); drawSettings(sh); return; }
  if (b.hasAttribute('data-secup') && t && rEl){ const i = +rEl.dataset.si; if (i > 0){ const [s] = t.sections.splice(i, 1); t.sections.splice(i - 1, 0, s); } drawSettings(sh); return; }
  if (b.hasAttribute('data-savesettings')){
    if (showErrors(sh).length){ sh.querySelector('.derr').scrollIntoView({block: 'nearest'}); return; }
    if (!isDate(draft.sprint.anchor)){ toast('Pick the day a sprint starts.'); sh.querySelector('[data-s=anchor]').focus(); return; }
    setSprint(draft.sprint); setTemplates(draft.templates); setRecurring(draft.recurring.filter(r => r.title.trim()));
    closeModal(); toast('Saved');
  }
}

/* ---------- drag and drop ---------- */
/* drag-drop.js calls this when a task row is dropped on a block or the tray. */
function dayDrop(taskId, zone, y){
  const d = curDate();
  if (zone.dataset.zone === 'dtray'){ const rec = dayView(dp, d).rec; if (slotOf(rec, taskId)) unplan(taskId); else render(); return; }
  const secId = zone.dataset.sec;
  const rows = [...zone.querySelectorAll(':scope > .row[data-id]')].filter(r => r.dataset.id !== taskId);
  const idx = rows.findIndex(r => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; });
  plan(taskId, secId, d, idx < 0 ? rows.length : idx);
}

/* ---------- the drawer's "Plan for" field ---------- */
let drawerDate = null;
function planFieldHtml(t){
  if (!dp.sprint.anchor || t.done) return '';
  const d = drawerDate || curDate(), rec = dayView(dp, d).rec, slot = slotOf(rec, t.id);
  const open = rec.sections.filter(s => !s.lost);
  return `<div class="dfld"><label for="dPlanDate">Plan for</label><div class="drow dplan">
    <input type="date" id="dPlanDate" data-f="plandate" data-fk="plandate" value="${d}">
    <select data-f="plansec" data-fk="plansec" aria-label="Block">${open.length ? '' : '<option value="">No blocks that day</option>'}${slot ? '' : open.length ? '<option value="">Pick a block</option>' : ''}${open.map(s => `<option value="${esc(s.id)}"${slot && slot.sectionId === s.id ? ' selected' : ''}>${esc(s.name)}${s.around ? ' · ' + esc(s.around) : ''}</option>`).join('')}</select>
    ${slot ? `<button class="lnk" data-d="unplan" data-fk="unplan">Unplan</button>` : ''}</div></div>`;
}
/* Returns true when the drawer should re-render. */
function planFieldChange(t, f, v){
  if (f === 'plandate'){ drawerDate = isDate(v) ? v : null; if (drawerDate) ensureYear(drawerDate); return true; }
  if (f === 'plansec'){ const d = drawerDate || curDate(); if (v) plan(t.id, v, d); else unplan(t.id, d); return true; }
  return false;
}
function planFieldClick(t, a){
  if (a !== 'unplan') return false;
  unplan(t.id, drawerDate || curDate()); return true;
}
const resetDrawerDate = () => { drawerDate = null; };

/* ---------- events ---------- */
function onClick(e){
  if (state.view !== 'day') return;
  const b = e.target.closest('[data-dp]'); if (!b) return;
  if (b.disabled) return;
  e.stopPropagation();
  if (menuEl) closeMenu();
  const a = b.dataset.dp, r = b.closest('.row[data-id]'), sec = b.closest('[data-sec]');
  const d = curDate();
  if (a === 'prev' || a === 'next') return setDate(nextWorkday(dp.sprint, d, a === 'prev' ? -1 : 1) || addDays(d, a === 'prev' ? -1 : 1));
  if (a === 'today') return setDate(todayStr());
  if (a === 'undo') return undo();
  if (a === 'redo') return redo();
  if (a === 'daymenu') return dayMenu(b);
  if (a === 'settings') return openSettings();
  if (a === 'addsec') return editSection(null);
  if (a === 'reset') return resetDialog();
  if (a === 'pick' || a === 'rowmenu') return r && pickSection(r.dataset.id, b);
  if (a === 'secmenu') return sec && sectionMenu(sec.dataset.sec, b);
  if (a === 'restore') return sec && dpChange([d], () => restoreSection(dp, d, sec.dataset.sec));
  if (a === 'tray-all' || a === 'tray-today'){ trayFilter = a.slice(5); render(); return; }
  if (a === 'carry-skip') return dpChange([d], () => dismissCarry(dp, d));
  if (a === 'carry-tray' || a === 'carry-sections'){
    const n = dpChange([d], () => carryOver(dp, d, a.slice(6), tasksById()));
    toast(`${plural(n, 'task')} carried over`, 'Undo', undo);
  }
}
function onSubmit(e){
  if (e.target.id !== 'dpSetup') return;
  e.preventDefault();
  const f = e.target, anchor = f.anchor.value;
  if (!isDate(anchor)) return;
  const sp = cleanSprint(Object.assign({}, dp.sprint, {anchor, lengthWeeks: +f.len.value}));
  setSprint(sp);
  if (f.example.checked && !dp.templates.length) setTemplates(exampleTemplates(sp));
  toast('Sprint saved. Change it any time with the gear.');
}
function onKey(e){
  if (state.view !== 'day' || isWaiting()) return;
  const ae = document.activeElement || document.body;
  if (e.target.id === 'dpDate') return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable;
  if (typing || modal.classList.contains('open') || menuEl || cmdOpen()) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (mod && !e.altKey && k === 'z'){ stop(); return e.shiftKey ? redo() : undo(); }
  if (mod && !e.altKey && k === 'y'){ stop(); return redo(); }
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')){
    const dir = e.key === 'ArrowUp' ? -1 : 1, d = curDate();
    const head = ae.closest && ae.closest('[data-sechead]');
    if (head){ stop(); const id = head.dataset.sechead; dpChange([d], () => moveSection(dp, d, id, dir)); requestAnimationFrame(() => { const h = main.querySelector(`[data-sechead="${CSS.escape(id)}"]`); if (h) h.focus(); }); return; }
    const rid = ae.closest && ae.closest('.row[data-id]') ? ae.closest('.row[data-id]').dataset.id : sel;
    if (rid && slotOf(dayView(dp, d).rec, rid)){ stop(); dpChange([d], () => moveInSection(dp, d, rid, dir, tasksById())); requestAnimationFrame(() => { const el = main.querySelector(`.row[data-id="${CSS.escape(rid)}"]`); if (el) el.focus(); }); return; }
    stop(); return;
  }
  if (mod || e.altKey) return;
  if (k === 'p'){
    const rid = ae.closest && ae.closest('.row[data-id]') ? ae.closest('.row[data-id]').dataset.id : sel;
    if (rid){ stop(); pickSection(rid, main.querySelector(`.row[data-id="${CSS.escape(rid)}"] .dpbtn`)); }
    return;
  }
  if (e.key === '['){ stop(); const d = curDate(); return setDate(nextWorkday(dp.sprint, d, -1) || addDays(d, -1)); }
  if (e.key === ']'){ stop(); const d = curDate(); return setDate(nextWorkday(dp.sprint, d, 1) || addDays(d, 1)); }
}
/* Section headers drag to reorder blocks (desktop). */
function onDragStart(e){
  const h = e.target.closest && e.target.closest('.dsec-h[draggable]'); if (!h || state.view !== 'day') return;
  secDrag = h.dataset.sechead;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', 'block'); } catch (_) {}
  setTimeout(() => h.parentElement.classList.add('dragging'), 0);
}
function onDragOver(e){
  if (!secDrag) return;
  const s = e.target.closest && e.target.closest('.dsec'); if (!s) return;
  e.preventDefault();
  main.querySelectorAll('.dsec.drop-before,.dsec.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
  const r = s.getBoundingClientRect();
  s.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
}
function onDrop(e){
  if (!secDrag) return;
  const s = e.target.closest && e.target.closest('.dsec');
  const id = secDrag; secDrag = null;
  if (!s){ render(); return; }
  e.preventDefault(); e.stopPropagation();
  const d = curDate(), rec = dayView(dp, d).rec;
  const ids = rec.sections.map(x => x.id).filter(x => x !== id);
  let i = ids.indexOf(s.dataset.sec);
  if (i < 0) i = ids.length; else if (s.classList.contains('drop-after')) i++;
  dpChange([d], () => placeSection(dp, d, id, i));
}
function onDragEnd(){ if (secDrag){ secDrag = null; render(); } }

function dayInit(){
  const page = document.querySelector('.page');
  page.addEventListener('click', onClick);
  page.addEventListener('submit', onSubmit);
  page.addEventListener('change', e => { if (e.target.id === 'dpDate' && isDate(e.target.value)) setDate(e.target.value); });
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('dragstart', onDragStart);
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('drop', onDrop, true);
  document.addEventListener('dragend', onDragEnd);
  // The "now" block changes with the clock: re-render when it does, if nothing is being edited.
  setInterval(() => {
    if (state.view !== 'day' || curDate() !== todayStr() || menuEl || modal.classList.contains('open')) return;
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
    const {current} = currentSection(dayView(dp, todayStr()).rec, nowMin());
    if ((current ? current.id : null) !== lastNow) render();
  }, 30000);
}

export { I as DAY_ICON, curDate, dayDrop, dayHead, dayInit, openSettings, planFieldChange, planFieldClick, planFieldHtml, renderDay, resetDrawerDate, setDate };
