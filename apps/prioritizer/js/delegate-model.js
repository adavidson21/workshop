/* Docket: delegating. Pure functions, no DOM and no SDK, so Node tests can import them.

   A task is delegated when it has people (`who`) and `waiting: true`: you handed it over and wait on them.
   Every waiting task gets a follow-up date (`nudgeOn`), a number of working days out (the Day view's workdays and
   holidays when a sprint is set, otherwise Monday to Friday). When the work comes back, "Got it back" ends the
   wait and marks the task `cameBack` (a date) so Today shows it once for intake; picking it for Today, finishing
   it, delegating it again or dismissing the chip clears that.

   Board setting (prioritizer.settings meta.follow): {days, filled}. `days` is the follow-up in working days
   (default 2); `filled` is the date waiting tasks without a follow-up date were given one, once per board. */
import { addCrumb } from './focus-model.js';
import { addDays, isDate } from './util.js';

export const FOLLOW_DEFAULT = 2;
export const FOLLOW_CHOICES = [1, 2, 3, 5, 10];
const MON_FRI = [1, 2, 3, 4, 5];

export function cleanFollow(f){
  const o = f && typeof f === 'object' ? f : {};
  const n = Math.round(+o.days);
  return {days: Number.isInteger(n) && n >= 1 && n <= 30 ? n : FOLLOW_DEFAULT, filled: isDate(o.filled) ? o.filled : null};
}

/** `n` working days after `from` (YYYY-MM-DD). sp: the Day view's sprint ({workdays, holidays}) or null. */
export function addWorkdays(from, n, sp = null){
  const work = sp && Array.isArray(sp.workdays) && sp.workdays.length ? sp.workdays : MON_FRI;
  const off = new Set(sp && Array.isArray(sp.holidays) ? sp.holidays : []);
  let d = from, left = Math.max(1, Math.round(n) || 1);
  for (let i = 0; i < 400 && left > 0; i++){
    d = addDays(d, 1);
    const [y, m, dd] = d.split('-').map(Number);
    if (work.includes(new Date(y, m - 1, dd).getDay()) && !off.has(d)) left--;
  }
  return d;
}

const snap = t => ({who: [...(t.who || [])], waiting: !!t.waiting, nudgeOn: t.nudgeOn || null, cameBack: t.cameBack || null});
/** What delegate, nudged and gotBack change, to put back for Undo. */
export const snapshot = snap;
export function restore(t, s){
  t.who = [...s.who]; t.waiting = s.waiting; t.nudgeOn = s.nudgeOn;
  if (s.cameBack) t.cameBack = s.cameBack; else delete t.cameBack;
}

/** Hand a task to people already on it (`who` set by the caller): waiting on them, follow up on `followOn`.
    A task already waiting keeps its date unless it had none. */
export function delegate(t, followOn){
  if (!t.waiting || !t.nudgeOn) t.nudgeOn = followOn;
  t.waiting = true;
  delete t.cameBack;
}

/** You nudged them: the next follow-up moves to `followOn`, and a breadcrumb says so. */
export function nudged(t, followOn, at, mentions = ''){
  t.nudgeOn = followOn;
  addCrumb(t, mentions ? `Nudged ${mentions}` : 'Nudged', at);
}

/** It came back: no longer waiting, back in your rank, shown once on Today as Came back. */
export function gotBack(t, today){
  t.waiting = false;
  t.nudgeOn = null;
  t.cameBack = today;
}

export const cameBackOpen = t => !!t && !t.done && isDate(t.cameBack);

/** Waiting tasks with no follow-up date get one. Returns how many changed. */
export function fillFollowUps(tasks, followOn){
  let n = 0;
  for (const t of tasks) if (t && !t.done && t.waiting && !t.nudgeOn){ t.nudgeOn = followOn; n++; }
  return n;
}

/** Text to paste into chat when handing a task over: title, notes, the ADO link and the due date. */
export function handoffText(t, names = [], fmtDate = d => d){
  const out = [t.title];
  if (names.length) out[0] = `${names.join(', ')}: ${t.title}`;
  if (t.notes && t.notes.trim()) out.push('', t.notes.trim());
  const link = t.ado && t.ado.url ? t.ado.url : t.pr && t.pr.url ? t.pr.url : '';
  if (link) out.push('', link);
  if (t.due) out.push('', `Due ${fmtDate(t.due)}`);
  return out.join('\n');
}

/** Order for the Assign picker: on the task, then your team, then people you assign to most, then everyone.
    items: active directory people and groups; onTeam(it); counts: Map id to how often tasks use it. */
export function pickerOrder(items, who, onTeam, counts, query = ''){
  const q = String(query || '').trim().replace(/^[>@]+/, '').toLowerCase();
  const on = new Set(who || []);
  const hit = it => !q || it.name.toLowerCase().includes(q) || it.handle.toLowerCase().includes(q);
  const starts = it => q && (it.name.toLowerCase().startsWith(q) || it.handle.toLowerCase().startsWith(q)) ? 0 : 1;
  const tier = it => on.has(it.id) ? 0 : onTeam(it) ? 1 : (counts.get(it.id) || 0) > 0 ? 2 : 3;
  return items.map((it, i) => ({it, i})).filter(({it}) => hit(it))
    .sort((a, b) => starts(a.it) - starts(b.it) || tier(a.it) - tier(b.it) || (counts.get(b.it.id) || 0) - (counts.get(a.it.id) || 0) || a.i - b.i)
    .map(({it}) => it);
}
