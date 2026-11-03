/* Docket: the day plan model. Sprint day math, templates, and every change the Day view makes to a day.
   Pure functions with no DOM, so Node tests can import them (test/dayplan.test.mjs).

   The day plan board (dp) has three parts, each saved as its own collection (dayplan-format.js):
     sprint     {anchor, lengthWeeks, workdays, holidays, dayStart, dayEnd}
     templates  [{id, name, days: [2, 3, ...], last, sections: [section]}]
     days       {<yyyy-mm-dd>: record}, only for dates that were edited
   A section is {id, name, kind, color, around, minutes, capacity}; on a day it can also have lost: true.
   A day record is {id: date, template, sections, slots: [{taskId, sectionId, order}], shift, carry}.
   A date with no record shows its template; the record is written on the first edit. */

const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(pd(s));
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return dstr(d); };
const daysBetween = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const rid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const isTime = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const toMin = s => isTime(s) ? +s.slice(0, 2) * 60 + +s.slice(3) : null;
const fromMin = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };

const COLORS = ['slate', 'sage', 'sky', 'butter', 'peach', 'blush', 'lavender', 'stone'];
const DEFAULT_SPRINT = {anchor: null, lengthWeeks: 2, workdays: [1, 2, 3, 4, 5], holidays: [], dayStart: '09:00', dayEnd: '17:00'};
const MAX_UNDO = 50;

/* ---------- cleaning (anything malformed is dropped or defaulted, unknown fields kept) ---------- */
const str = (v, n = 80) => typeof v === 'string' ? v.slice(0, n) : '';
const num = v => Number.isFinite(+v) && v !== '' && v !== null && +v >= 0 ? Math.round(+v * 10) / 10 : null;
function cleanSprint(s){
  const o = Object.assign({}, clone(s) || {});
  o.anchor = isDate(o.anchor) ? o.anchor : null;
  o.lengthWeeks = Number.isInteger(+o.lengthWeeks) && +o.lengthWeeks >= 1 && +o.lengthWeeks <= 8 ? +o.lengthWeeks : 2;
  o.workdays = Array.isArray(o.workdays) ? [...new Set(o.workdays.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : [1, 2, 3, 4, 5];
  if (!o.workdays.length) o.workdays = [1, 2, 3, 4, 5];
  o.holidays = Array.isArray(o.holidays) ? [...new Set(o.holidays.filter(isDate))].sort() : [];
  o.dayStart = isTime(o.dayStart) ? o.dayStart : '09:00';
  o.dayEnd = isTime(o.dayEnd) ? o.dayEnd : '17:00';
  return o;
}
function cleanSection(s){
  if (!s || typeof s !== 'object') return null;
  const o = Object.assign({}, clone(s));
  o.id = str(o.id, 40) || rid();
  o.name = str(o.name).trim() || 'Untitled';
  o.kind = str(o.kind, 40).trim().toLowerCase();
  o.color = COLORS.includes(o.color) ? o.color : 'slate';
  o.around = isTime(o.around) ? o.around : null;
  o.minutes = num(o.minutes); if (o.minutes != null) o.minutes = Math.min(1440, Math.round(o.minutes));
  o.capacity = num(o.capacity);
  if (o.lost !== true) delete o.lost;
  return o;
}
const cleanSections = a => Array.isArray(a) ? a.map(cleanSection).filter(Boolean).slice(0, 40) : [];
function cleanTemplate(t){
  if (!t || typeof t !== 'object') return null;
  const o = Object.assign({}, clone(t));
  o.id = str(o.id, 40) || rid();
  o.name = str(o.name).trim() || 'Template';
  o.days = Array.isArray(o.days) ? [...new Set(o.days.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 60))].sort((a, b) => a - b) : [];
  o.last = o.last === true;
  o.sections = cleanSections(o.sections);
  return o;
}
function cleanRecord(r, date){
  if (!r || typeof r !== 'object') return null;
  const o = Object.assign({}, clone(r));
  o.id = isDate(o.id) ? o.id : date;
  if (!isDate(o.id)) return null;
  o.template = typeof o.template === 'string' ? o.template : null;
  o.sections = cleanSections(o.sections);
  const secs = new Set(o.sections.map(s => s.id)), seen = new Set();
  o.slots = (Array.isArray(o.slots) ? o.slots : []).filter(s => s && typeof s.taskId === 'string' && secs.has(s.sectionId) && !seen.has(s.taskId) && seen.add(s.taskId))
    .map(s => ({taskId: s.taskId, sectionId: s.sectionId, order: Number.isFinite(s.order) ? s.order : null}));
  o.shift = Number.isFinite(o.shift) ? Math.round(o.shift) : 0;
  if (o.carry && typeof o.carry === 'object'){
    o.carry = {done: o.carry.done === true, tray: Array.isArray(o.carry.tray) ? o.carry.tray.filter(x => typeof x === 'string').slice(0, 200) : []};
  } else delete o.carry;
  return o;
}
/* The whole day plan board, cleaned. Mutates and returns dp. */
function cleanDayplan(dp){
  dp = dp && typeof dp === 'object' ? dp : {};
  dp.sprint = cleanSprint(dp.sprint);
  dp.templates = Array.isArray(dp.templates) ? dp.templates.map(cleanTemplate).filter(Boolean) : [];
  dp.recurring = Array.isArray(dp.recurring) ? dp.recurring.map(cleanRecurring).filter(Boolean) : [];
  const days = {};
  for (const [k, r] of Object.entries(dp.days && typeof dp.days === 'object' ? dp.days : {})){
    const c = cleanRecord(r, k); if (c) days[c.id] = c;
  }
  dp.days = days;
  return dp;
}
const freshDayplan = () => cleanDayplan({});

/* ---------- sprint math ---------- */
const isWorkday = (sp, date) => sp.workdays.includes(pd(date).getDay()) && !sp.holidays.includes(date);
const sprintLen = sp => sp.lengthWeeks * 7;
const sprintIndex = (sp, date) => Math.floor(daysBetween(sp.anchor, date) / sprintLen(sp));
const sprintStartOf = (sp, idx) => addDays(sp.anchor, idx * sprintLen(sp));
/* Sprint id: "<year>-<n>", the nth sprint starting in the calendar year its first day falls in. Anchor based,
   so it works for dates before the anchor too. */
function sprintId(sp, idx){
  const start = sprintStartOf(sp, idx), y = start.slice(0, 4);
  let first = sprintIndex(sp, `${y}-01-01`);
  if (sprintStartOf(sp, first) < `${y}-01-01`) first++;
  return `${y}-${idx - first + 1}`;
}
/* Where a date sits in its sprint. null when there is no anchor. day is null on a day off. */
function sprintInfo(sp, date){
  if (!sp || !sp.anchor || !isDate(date)) return null;
  const idx = sprintIndex(sp, date), start = sprintStartOf(sp, idx), end = addDays(start, sprintLen(sp) - 1);
  let total = 0, day = null;
  for (let d = start; d <= end; d = addDays(d, 1)){
    if (!isWorkday(sp, d)) continue;
    total++;
    if (d === date) day = total;
  }
  return {index: idx, id: sprintId(sp, idx), start, end, day, total, off: day == null, last: day != null && day === total, holiday: sp.holidays.includes(date)};
}
function nextWorkday(sp, date, dir = 1){
  let d = date;
  for (let i = 0; i < 370; i++){ d = addDays(d, dir); if (isWorkday(sp, d)) return d; }
  return null;
}

/* ---------- templates ---------- */
/* The template for a date. A Last day template beats a numbered one on the sprint's last working day, so a
   holiday that shortens a sprint does not make "days 1 to 9" and "Last day" collide. */
function templateFor(dp, date){
  const info = sprintInfo(dp.sprint, date);
  if (!info || info.off) return {template: null, info, conflict: []};
  const lasts = info.last ? dp.templates.filter(t => t.last) : [];
  const nums = dp.templates.filter(t => t.days.includes(info.day));
  const pool = lasts.length ? lasts : nums;
  return {template: pool[0] || null, info, conflict: pool.length > 1 ? pool : []};
}
/* Problems Settings shows: two templates on the same sprint day number, or two Last day templates. */
function templateErrors(templates, sp){
  const errs = [], max = sprintLen(cleanSprint(sp));
  for (let d = 1; d <= max; d++){
    const hit = templates.filter(t => t.days.includes(d));
    if (hit.length > 1) errs.push(`Day ${d} is in ${hit.map(t => `"${t.name}"`).join(' and ')}. Each day can use one template.`);
  }
  const lasts = templates.filter(t => t.last);
  if (lasts.length > 1) errs.push(`${lasts.map(t => `"${t.name}"`).join(' and ')} are both for the last day. Pick one.`);
  return errs;
}
/* "2-8, 10" into [2..8, 10]. */
function parseDays(text){
  const out = new Set();
  for (const part of String(text || '').split(/[,\s]+/).filter(Boolean)){
    const m = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(part);
    if (!m) return null;
    const a = +m[1], b = m[2] ? +m[2] : a;
    if (a < 1 || b < a || b > 60) return null;
    for (let i = a; i <= b; i++) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}
function formatDays(days){
  const out = []; let i = 0;
  while (i < days.length){
    let j = i; while (j + 1 < days.length && days[j + 1] === days[j] + 1) j++;
    out.push(j > i ? `${days[i]}-${days[j]}` : `${days[i]}`); i = j + 1;
  }
  return out.join(', ');
}

/* ---------- a day ---------- */
/* What a date shows: its record, or a fresh copy of its template (not saved). */
function dayView(dp, date){
  const {template, info, conflict} = templateFor(dp, date);
  const rec = dp.days[date];
  if (rec) return {rec, info, template, conflict, saved: true};
  return {rec: {id: date, template: template ? template.id : null, sections: template ? clone(template.sections).map(s => (delete s.lost, s)) : [], slots: [], shift: 0}, info, template, conflict, saved: false};
}
/* The record to edit for a date, written into dp on first use. */
function editDay(dp, date){
  if (!dp.days[date]) dp.days[date] = dayView(dp, date).rec;
  return dp.days[date];
}
const sectionOf = (rec, id) => rec.sections.find(s => s.id === id);
const slotOf = (rec, taskId) => rec.slots.find(s => s.taskId === taskId);
/* Tasks in a section, in display order: manual order where set, then rank. Deleted tasks are left out. */
function sectionTasks(rec, sectionId, tasksById){
  return rec.slots.filter(s => s.sectionId === sectionId && tasksById.has(s.taskId))
    .map(s => ({slot: s, task: tasksById.get(s.taskId)}))
    .sort((a, b) => ((a.slot.order ?? Infinity) - (b.slot.order ?? Infinity)) || (a.task.rank - b.task.rank));
}
/* Capacity in effort points: what is planned (done tasks count, they were part of the plan). */
function sectionLoad(rec, sectionId, tasksById, points){
  return sectionTasks(rec, sectionId, tasksById).reduce((n, {task}) => n + (points[task.effort] || 0), 0);
}
const overCapacity = (sec, load) => sec.capacity != null && load > sec.capacity;

/* The section on now (by rough time) and the next one. Sections without a time are skipped. */
function currentSection(rec, nowMin){
  const timed = rec.sections.filter(s => !s.lost && s.around).map(s => ({s, at: toMin(s.around)})).sort((a, b) => a.at - b.at);
  let cur = null, next = null;
  for (let i = 0; i < timed.length; i++){
    const end = timed[i].s.minutes ? timed[i].at + timed[i].s.minutes : (timed[i + 1] ? timed[i + 1].at : timed[i].at + 60);
    if (nowMin >= timed[i].at && nowMin < end){ cur = timed[i].s; next = timed[i + 1] ? timed[i + 1].s : null; break; }
    if (nowMin < timed[i].at){ next = timed[i].s; break; }
  }
  return {current: cur, next};
}

/* ---------- changes to a day (each mutates dp and returns something useful) ---------- */
function slotTask(dp, date, taskId, sectionId, index = null, tasksById = null){
  if (!sectionOf(dayView(dp, date).rec, sectionId)) return false;
  const rec = editDay(dp, date);
  rec.slots = rec.slots.filter(s => s.taskId !== taskId);
  rec.slots.push({taskId, sectionId, order: null});
  if (index != null && tasksById){
    const ids = sectionTasks(rec, sectionId, tasksById).map(x => x.task.id).filter(id => id !== taskId);
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, taskId);
    setSectionOrder(rec, sectionId, ids);
  }
  return true;
}
function unslotTask(dp, date, taskId){
  const rec = editDay(dp, date);
  const n = rec.slots.length;
  rec.slots = rec.slots.filter(s => s.taskId !== taskId);
  return rec.slots.length !== n;
}
function setSectionOrder(rec, sectionId, ids){
  ids.forEach((id, i) => { const s = rec.slots.find(x => x.taskId === id && x.sectionId === sectionId); if (s) s.order = i; });
}
/* Move a task up or down inside its section. */
function moveInSection(dp, date, taskId, dir, tasksById){
  const rec = editDay(dp, date), slot = slotOf(rec, taskId); if (!slot) return false;
  const ids = sectionTasks(rec, slot.sectionId, tasksById).map(x => x.task.id);
  const i = ids.indexOf(taskId), j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return false;
  ids.splice(i, 1); ids.splice(j, 0, taskId);
  setSectionOrder(rec, slot.sectionId, ids);
  return true;
}
function moveSection(dp, date, sectionId, dir){
  const rec = editDay(dp, date), i = rec.sections.findIndex(s => s.id === sectionId), j = i + dir;
  if (i < 0 || j < 0 || j >= rec.sections.length) return false;
  const [s] = rec.sections.splice(i, 1); rec.sections.splice(j, 0, s);
  return true;
}
function placeSection(dp, date, sectionId, index){
  const rec = editDay(dp, date), i = rec.sections.findIndex(s => s.id === sectionId);
  if (i < 0) return false;
  const [s] = rec.sections.splice(i, 1);
  rec.sections.splice(Math.max(0, Math.min(index, rec.sections.length)), 0, s);
  return i !== rec.sections.indexOf(s);
}
function addSection(dp, date, fields = {}){
  const rec = editDay(dp, date);
  const s = cleanSection(Object.assign({id: rid(), name: 'New block', kind: '', color: 'slate'}, fields));
  rec.sections.push(s);
  return s;
}
function updateSection(dp, date, sectionId, fields){
  const rec = editDay(dp, date), s = sectionOf(rec, sectionId); if (!s) return false;
  Object.assign(s, cleanSection(Object.assign({}, s, fields)));
  return true;
}
/* Remove a section for this day. Its tasks go back to the tray. */
function removeSection(dp, date, sectionId){
  const rec = editDay(dp, date);
  rec.sections = rec.sections.filter(s => s.id !== sectionId);
  rec.slots = rec.slots.filter(s => s.sectionId !== sectionId);
  return true;
}
/* Lost this block: the section is gone for today. Its unfinished tasks move to the next open section today
   ('next'), or to the next working day's first section of the same kind ('tomorrow'; its first open section
   if none has that kind). With nowhere to go they go back to the tray. Returns where they went. */
function loseSection(dp, date, sectionId, dest, tasksById){
  const rec = editDay(dp, date), i = rec.sections.findIndex(s => s.id === sectionId);
  if (i < 0) return null;
  const sec = rec.sections[i];
  sec.lost = true;
  const moving = sectionTasks(rec, sectionId, tasksById).filter(x => !x.task.done).map(x => x.task.id);
  if (dest === 'tomorrow'){
    const next = nextWorkday(dp.sprint, date) || addDays(date, 1);
    const tr = editDay(dp, next), open = tr.sections.filter(s => !s.lost);
    const to = open.find(s => s.kind && s.kind === sec.kind) || open[0] || null;
    rec.slots = rec.slots.filter(s => !moving.includes(s.taskId));
    if (to) moving.forEach(id => slotTask(dp, next, id, to.id));
    return {date: next, section: to, count: moving.length};
  }
  const open = rec.sections.slice(i + 1).find(s => !s.lost) || null;
  if (open) moving.forEach(id => { const s = slotOf(rec, id); s.sectionId = open.id; s.order = null; });
  else rec.slots = rec.slots.filter(s => !moving.includes(s.taskId));
  return {date, section: open, count: moving.length};
}
function restoreSection(dp, date, sectionId){
  const s = sectionOf(editDay(dp, date), sectionId); if (!s) return false;
  delete s.lost; return true;
}
/* Shift the rest of the day: rough times of the open sections from `fromId` on (all of them without it) move
   by `minutes`. Returns how many moved. */
function shiftDay(dp, date, minutes, fromId = null){
  const rec = editDay(dp, date);
  let on = !fromId, n = 0;
  for (const s of rec.sections){
    if (s.id === fromId) on = true;
    if (!on || s.lost || !s.around) continue;
    s.around = fromMin(toMin(s.around) + minutes); n++;
  }
  rec.shift = (rec.shift || 0) + minutes;
  return n;
}
/* The first open section that has not started yet (by rough time), for "shift the rest of the day". */
function restFrom(rec, nowMin){
  const s = rec.sections.find(x => !x.lost && x.around && toMin(x.around) + (x.minutes || 0) > nowMin);
  return s ? s.id : null;
}
/* Reset to template: the date's edits are dropped. */
function resetDay(dp, date){
  if (!dp.days[date]) return false;
  delete dp.days[date]; return true;
}

/* ---------- carry over ---------- */
/* Unfinished tasks planned on the previous working day that are not planned on this date. */
function carryCandidates(dp, date, tasksById){
  const prev = nextWorkday(dp.sprint, date, -1);
  const rec = prev && dp.days[prev];
  if (!rec) return {prev, items: []};
  const here = dp.days[date];
  const planned = new Set(here ? here.slots.map(s => s.taskId) : []);
  const items = rec.slots.filter(s => tasksById.has(s.taskId) && !tasksById.get(s.taskId).done && !planned.has(s.taskId))
    .map(s => ({taskId: s.taskId, section: sectionOf(rec, s.sectionId)}));
  return {prev, items};
}
const carryPending = (dp, date, tasksById) => { const r = dp.days[date]; return !(r && r.carry && r.carry.done) && carryCandidates(dp, date, tasksById).items.length > 0; };
/* how: 'sections' puts each into today's section with the same name, then the same kind, then the first open
   one; 'tray' keeps them unplanned but listed first in the tray. */
function carryOver(dp, date, how, tasksById){
  const {items} = carryCandidates(dp, date, tasksById);
  const rec = editDay(dp, date);
  rec.carry = rec.carry || {done: false, tray: []};
  for (const {taskId, section} of items){
    const open = rec.sections.filter(s => !s.lost);
    const to = how === 'sections' && (open.find(s => section && s.name === section.name) || open.find(s => section && section.kind && s.kind === section.kind) || open[0]);
    if (to) slotTask(dp, date, taskId, to.id);
    else if (!rec.carry.tray.includes(taskId)) rec.carry.tray.push(taskId);
  }
  rec.carry.done = true;
  return items.length;
}
function dismissCarry(dp, date){
  const rec = editDay(dp, date);
  rec.carry = Object.assign({tray: []}, rec.carry, {done: true});
}

/* ---------- every-sprint tasks ----------
   A recurring item is {id, title, dueDay, last, value, effort, listId, notes, paused}. Each sprint whose due day
   has not passed gets one fresh task on its first working day (or as soon as Docket opens after that), due on
   that sprint day. The task's id is fixed per item and sprint (r_<item id>_<sprint start>), so two windows make
   the same task, and a task you delete stays deleted (made lists the sprints already done). */
const EFFORT_KEYS = ['XS', 'S', 'M', 'L', 'XL'];
function cleanRecurring(r){
  if (!r || typeof r !== 'object') return null;
  const o = Object.assign({}, clone(r));
  o.id = str(o.id, 40) || rid();
  o.title = str(o.title, 300).trim();
  if (!o.title) return null;
  o.dueDay = Number.isInteger(+o.dueDay) && +o.dueDay >= 1 && +o.dueDay <= 60 ? +o.dueDay : 1;
  o.last = o.last === true;
  o.value = Number.isInteger(+o.value) && +o.value >= 1 && +o.value <= 4 ? +o.value : 2;
  o.effort = EFFORT_KEYS.includes(o.effort) ? o.effort : 'S';
  o.listId = typeof o.listId === 'string' ? o.listId : null;
  o.notes = str(o.notes, 2000);
  o.paused = o.paused === true;
  o.planKind = str(o.planKind, 40).trim().toLowerCase();
  o.made = Array.isArray(o.made) ? [...new Set(o.made.filter(isDate))].sort().slice(-12) : [];
  return o;
}
/* The date of sprint day n in the sprint starting at start (the last working day if the sprint is shorter). */
function sprintDayDate(sp, start, n, last = false){
  const end = addDays(start, sprintLen(sp) - 1);
  let k = 0, lastDay = null;
  for (let d = start; d <= end; d = addDays(d, 1)){
    if (!isWorkday(sp, d)) continue;
    k++; lastDay = d;
    if (!last && k === n) return d;
  }
  return lastDay;
}
const recurTaskId = (item, start) => `r_${item.id}_${start}`;
/* Tasks to create on `today`: [{item, id, start, due}]. Skips paused items, sprints already made, and sprints
   whose due day has passed. today must be on or after the sprint's first working day. */
function recurDue(dp, today){
  const info = sprintInfo(dp.sprint, today);
  if (!info) return [];
  const first = sprintDayDate(dp.sprint, info.start, 1);
  if (!first || today < first) return [];
  const out = [];
  for (const item of dp.recurring){
    if (item.paused || item.made.includes(info.start)) continue;
    const due = sprintDayDate(dp.sprint, info.start, item.dueDay, item.last);
    if (!due || today > due) continue;
    out.push({item, id: recurTaskId(item, info.start), start: info.start, due, sprint: info.id});
  }
  return out;
}

/* Automatic Day planning: put an every-sprint task into the first open block of the item's kind on its due day
   (that day's first open block if none has the kind). Done once, when the task is made, so unplanning it
   sticks. Returns the block, or null when the item has no kind, the day has no open blocks, or the task is
   already planned that day. */
function autoPlan(dp, item, taskId, due){
  if (!item.planKind) return null;
  const rec = dayView(dp, due).rec;
  if (slotOf(rec, taskId)) return null;
  const open = rec.sections.filter(s => !s.lost);
  const to = open.find(s => s.kind === item.planKind) || open[0];
  if (!to) return null;
  slotTask(dp, due, taskId, to.id);
  return to;
}

/* ---------- undo and redo (per window) ----------
   Each entry is the records of the dates an action touched, as they were before ({date: record or null}). */
function createHistory(max = MAX_UNDO){
  const undo = [], redo = [];
  const snap = (dp, dates) => Object.fromEntries(dates.map(d => [d, dp.days[d] ? clone(dp.days[d]) : null]));
  const put = (dp, s) => { for (const [d, r] of Object.entries(s)){ if (r) dp.days[d] = clone(r); else delete dp.days[d]; } };
  return {
    /** Run fn (which changes dp) and record it. dates: every date fn may change. Returns fn's result. */
    run(dp, dates, fn){
      const before = snap(dp, dates);
      const out = fn();
      const after = snap(dp, dates);
      if (JSON.stringify(before) === JSON.stringify(after)) return out;
      undo.push({before, after, dates}); if (undo.length > max) undo.shift();
      redo.length = 0;
      return out;
    },
    undo(dp){ const e = undo.pop(); if (!e) return null; put(dp, e.before); redo.push(e); return e.dates; },
    redo(dp){ const e = redo.pop(); if (!e) return null; put(dp, e.after); undo.push(e); return e.dates; },
    get canUndo(){ return undo.length > 0; }, get canRedo(){ return redo.length > 0; },
    clear(){ undo.length = 0; redo.length = 0; }
  };
}

export {
  autoPlan, cleanRecurring, recurDue, recurTaskId, sprintDayDate,
  COLORS, DEFAULT_SPRINT, addDays, addSection, carryCandidates, carryOver, carryPending, cleanDayplan, cleanRecord, cleanSection,
  cleanSprint, cleanTemplate, createHistory, currentSection, dayView, daysBetween, dismissCarry, editDay, formatDays, freshDayplan,
  fromMin, isDate, isTime, isWorkday, loseSection, moveInSection, moveSection, nextWorkday, overCapacity, parseDays, placeSection,
  removeSection, resetDay, restFrom, restoreSection, sectionLoad, sectionOf, sectionTasks, shiftDay, slotOf, slotTask, sprintInfo,
  templateErrors, templateFor, toMin, unslotTask, updateSection
};
